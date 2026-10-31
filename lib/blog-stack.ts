import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';
import {
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';

const ROOT = path.join(__dirname, '..');

export const PARAMETER_PREFIX = '/blog';

// SPA rewrites (/<postId>, /admin…, /docs) and old WordPress URLs (/<slug>/, /wp-admin, /YYYY/MM/, /page/N/). Shared with the dev server.
export const VIEWER_REQUEST_CODE = fs.readFileSync(path.join(ROOT, 'functions/viewer-request.js'), 'utf8');

export interface BlogStackProps extends StackProps {
  /** Subdomain under the MainDomain export. */
  subdomain?: string;
  /** Send CloudFront logs to the TrafficMonitor stack (needs its exports). */
  trafficLogging?: boolean;
}

/**
 * Serverless blog: nothing runs while nobody writes.
 * Readers get static files from CloudFront (the app from SiteBucket, published posts as JSON and
 * media from ContentBucket). Authors call the Lambda API, which saves posts in DynamoDB and
 * rewrites the public JSON when a post is published, changed or removed. Readers only reach it for
 * reactions and (cached) post-page link previews.
 */
export class BlogStack extends Stack {
  constructor(scope: Construct, id: string, props: BlogStackProps = {}) {
    super(scope, id, props);

    const subdomain = props.subdomain ?? 'blog';
    const rootDomain = Fn.importValue('MainDomain');
    const domainName = Fn.join('', [`${subdomain}.`, rootDomain]);
    const siteUrl = Fn.join('', ['https://', domainName]);
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'ImportedHostedZone', {
      zoneName: rootDomain,
      hostedZoneId: Fn.importValue('MainHostedZoneId'),
    });

    // ---------- Data ----------
    const table = new dynamodb.TableV2(this, 'Posts', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    // API tokens for agents (hash of the secret only). Expired tokens are removed by TTL.
    const tokensTable = new dynamodb.TableV2(this, 'Tokens', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Readers' reactions: per post a counts item and one item per visitor (dl_vid); per IP hash,
    // rate-limit windows that expire through TTL.
    const reactionsTable = new dynamodb.TableV2(this, 'Reactions', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Published JSON (content/), post media (media/) and uploads in progress (pending/).
    // Private: readers get content/ and media/ through CloudFront; authors upload with presigned URLs.
    const contentBucket = new s3.Bucket(this, 'ContentBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
      cors: [{
        allowedMethods: [s3.HttpMethods.PUT],
        allowedOrigins: [siteUrl],
        allowedHeaders: ['content-type'],
        maxAge: 3600,
      }],
      lifecycleRules: [
        { id: 'expire-pending-uploads', prefix: 'pending/', expiration: Duration.days(1) },
        { id: 'abort-multipart', abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
    });

    // ---------- API (authors, post pages and reactions) ----------
    const apiHandler = new lambda.Function(this, 'ApiHandler', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(ROOT, 'lambda/api')),
      timeout: Duration.seconds(15),
      memorySize: 512,
      // The account's Lambda concurrency is shared with the other dliu.com sites.
      reservedConcurrentExecutions: 10,
      description: 'blog.dliu.com posts API and Microsoft Entra sign-in',
      environment: {
        SITE_URL: siteUrl,
        ROOT_DOMAIN: rootDomain,
        TABLE_NAME: table.tableName,
        TOKENS_TABLE: tokensTable.tableName,
        REACTIONS_TABLE: reactionsTable.tableName,
        CONTENT_BUCKET: contentBucket.bucketName,
        PARAMETER_PREFIX,
      },
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(apiHandler);
    tokensTable.grantReadWriteData(apiHandler);
    reactionsTable.grantReadWriteData(apiHandler);
    contentBucket.grantReadWrite(apiHandler);
    contentBucket.grantDelete(apiHandler);
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameters'],
      resources: [this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: PARAMETER_PREFIX.slice(1) + '/*' })],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: ['*'],
      conditions: { StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` } },
    }));
    const functionUrl = apiHandler.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    // ---------- Website ----------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    // The post-page handler reads index.html to add each post's link-preview tags.
    siteBucket.grantRead(apiHandler, 'index.html');
    apiHandler.addEnvironment('SITE_BUCKET', siteBucket.bucketName);

    // CloudFront requires its certificate in us-east-1 (same pattern as the other sites).
    const certificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
      domainName,
      hostedZone,
      region: 'us-east-1',
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SiteHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          // Uploads go straight to the content bucket; posts may show pictures from other https sites
          // and videos from video.dliu.com.
          contentSecurityPolicy: Fn.join('', [
            "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; ",
            "img-src 'self' data: blob: https:; media-src 'self' blob:; ",
            "connect-src 'self' https://", contentBucket.bucketRegionalDomainName, '; ',
            "frame-src https://video.dliu.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          ]),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: false, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', override: true },
        ],
      },
    });

    const viewerRequest = new cloudfront.Function(this, 'ViewerRequest', {
      comment: 'blog.dliu.com app routes and old WordPress links',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(VIEWER_REQUEST_CODE),
    });

    const functionAssociations: cloudfront.FunctionAssociation[] = [
      { eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: viewerRequest },
    ];
    const trafficLogging = props.trafficLogging ?? true;
    // Makes CloudFront add CloudFront-Viewer-City so the visitor function can log the city.
    const trafficGeoPolicy = trafficLogging
      ? cloudfront.OriginRequestPolicy.fromOriginRequestPolicyId(this, 'TrafficGeo', Fn.importValue('TrafficGeoOriginRequestPolicyId'))
      : undefined;
    if (trafficLogging) {
      functionAssociations.push({
        eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
        function: cloudfront.Function.fromFunctionAttributes(this, 'VisitorId', {
          functionArn: Fn.importValue('TrafficVisitorFunctionArn'),
          functionName: 'dliu-visitor-id',
        }),
      });
    }

    const apiOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl, { readTimeout: Duration.seconds(15) });
    const siteOrigin = origins.S3BucketOrigin.withOriginAccessControl(siteBucket);
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy: headers,
      // Copies "Authorization: Bearer" to x-blog-token, because CloudFront replaces Authorization when it signs for Lambda.
      functionAssociations: [{ eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: viewerRequest }],
    };

    // Honours the object's Cache-Control: post JSON is no-cache (revalidated, so edits show at once),
    // media is cached for a day.
    const contentCache = new cloudfront.CachePolicy(this, 'ContentCache', {
      comment: 'blog.dliu.com published posts and media',
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.days(1),
      maxTtl: Duration.days(365),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const contentBehavior: cloudfront.BehaviorOptions = {
      origin: origins.S3BucketOrigin.withOriginAccessControl(contentBucket),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: contentCache,
      responseHeadersPolicy: headers,
      compress: true,
    };

    // Post pages (/<postId>, IDs start with the year): the API Lambda serves index.html with the post's
    // link-preview tags. If it answers 404 (not published) or fails, CloudFront serves the plain index.html,
    // so readers never depend on the Lambda. Cached per post ID (x-blog-post) for as long as the Lambda says.
    const postPageCache = new cloudfront.CachePolicy(this, 'PostPageCache', {
      comment: 'blog.dliu.com post pages, keyed by post ID',
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.days(1),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList('x-blog-post'),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const postPageBehavior: cloudfront.BehaviorOptions = {
      origin: new origins.OriginGroup({
        primaryOrigin: apiOrigin,
        fallbackOrigin: siteOrigin,
        fallbackStatusCodes: [403, 404, 500, 502, 503, 504],
      }),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: postPageCache,
      originRequestPolicy: trafficGeoPolicy,
      responseHeadersPolicy: headers,
      compress: true,
      functionAssociations,
    };

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      comment: 'blog.dliu.com',
      defaultBehavior: {
        origin: siteOrigin,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: trafficGeoPolicy,
        responseHeadersPolicy: headers,
        compress: true,
        functionAssociations,
      },
      additionalBehaviors: {
        'api/*': apiBehavior,
        'auth/*': apiBehavior,
        'content/*': contentBehavior,
        'media/*': contentBehavior,
        '20????????': postPageBehavior,
      },
      domainNames: [domainName],
      certificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });
    if (trafficLogging) {
      // TrafficMonitor delivers this distribution's access logs (CloudFront standard logging v2).
      // IncludeCookies is the only legacy logging setting v2 honours: it puts the dl_vid cookie in the logs.
      // CloudFront logs the whole Cookie header; the traffic monitor's partitioner keeps only dl_vid.
      (distribution.node.defaultChild as cloudfront.CfnDistribution)
        .addPropertyOverride('DistributionConfig.Logging', { IncludeCookies: true });
    }

    // New function URLs require both invoke permissions. CDK adds InvokeFunctionUrl.
    apiHandler.addPermission('CloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: distribution.distributionArn,
      invokedViaFunctionUrl: true,
    });

    new s3deploy.BucketDeployment(this, 'SiteContent', {
      sources: [s3deploy.Source.asset(path.join(ROOT, 'web'))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      // Browsers revalidate (cheap 304s) so a deploy takes effect on the next load.
      cacheControl: [s3deploy.CacheControl.noCache()],
    });

    new route53.ARecord(this, 'SiteAliasRecord', {
      recordName: subdomain,
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });
    new route53.AaaaRecord(this, 'SiteAliasIpv6Record', {
      recordName: subdomain,
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
    });

    new CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new CfnOutput(this, 'AuthRedirectUri', { value: Fn.join('', [siteUrl, '/auth/callback']) });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'ContentBucketName', { value: contentBucket.bucketName });
    new CfnOutput(this, 'ApiFunctionName', { value: apiHandler.functionName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
  }
}
