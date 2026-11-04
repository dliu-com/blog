import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';
import { stageVersionedWeb } from './versioned-web';
import {
  aws_apigatewayv2 as apigateway,
  aws_apigatewayv2_authorizers as authorizers,
  aws_apigatewayv2_integrations as integrations,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_events as events,
  aws_events_targets as eventTargets,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as eventSources,
  aws_logs as logs,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_sqs as sqs,
  aws_ssm as ssm,
  CfnOutput,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  StackProps,
} from 'aws-cdk-lib';
import apiRoutes from '../lambda/api/routes.json';

const ROOT = path.join(__dirname, '..');

export const PARAMETER_PREFIX = '/blog';
/** Shared by every dliu.com app; owned by the dliu-com/audit stack. */
export const SHARED_TENANT_PARAMETER = '/dliu/entra-tenant-id';
export const SHARED_API_APP_PARAMETER = '/dliu/api-app-id';

// SPA rewrites (/<postId>, /admin…, /docs) and old WordPress URLs (/<slug>/, /wp-admin, /YYYY/MM/, /page/N/). Shared with the dev server.
export const VIEWER_REQUEST_CODE = fs.readFileSync(path.join(ROOT, 'functions/viewer-request.js'), 'utf8');

// The agent-readable API guide names the managed API origin; the deployed copy gets the real MicrosoftApiUrl.
export const API_DOC = 'docs/api.md';
export const API_URL_PLACEHOLDER = '{{MICROSOFT_API_URL}}';
export const HEALTH_DOC = 'docs/health.md';
// Site files other than the HTML shells. Every deploy invalidates them at CloudFront.
export const STATIC_CACHE = 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400';
// Requests per second (and burst) for the whole Microsoft API stage; scripts and agents need far less.
export const MICROSOFT_API_RATE = 10;
export const MICROSOFT_API_BURST = 20;

export interface BlogStackProps extends StackProps {
  /** Subdomain under the MainDomain export. */
  subdomain?: string;
  /** Send CloudFront logs to the TrafficMonitor stack (needs its exports). */
  trafficLogging?: boolean;
  /**
   * Managed API for trusted tools: API Gateway checks Microsoft Entra access tokens (scopes blog.read,
   * blog.write, blog.delete) before the API Lambda checks tenant, client, identity and the api.access role.
   * Reads the shared /dliu/entra-tenant-id and /dliu/api-app-id parameters at deploy time.
   */
  microsoftApi?: boolean;
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
      // Media changes clear CloudFront's copy (see MediaInvalidator).
      eventBridgeEnabled: true,
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
      // No START/END/REPORT line per call, so a request flood doesn't also run up the log bill.
      loggingFormat: lambda.LoggingFormat.JSON,
      systemLogLevelV2: lambda.SystemLogLevel.WARN,
      applicationLogLevelV2: lambda.ApplicationLogLevel.INFO,
      environment: {
        SITE_URL: siteUrl,
        ROOT_DOMAIN: rootDomain,
        TABLE_NAME: table.tableName,
        REACTIONS_TABLE: reactionsTable.tableName,
        CONTENT_BUCKET: contentBucket.bucketName,
        PARAMETER_PREFIX,
        SHARED_TENANT_PARAMETER,
      },
      logGroup: new logs.LogGroup(this, 'ApiLogs', {
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    table.grantReadWriteData(apiHandler);
    reactionsTable.grantReadWriteData(apiHandler);
    // Least privilege: exactly the S3 calls in lambda/api/s3.js, on the prefixes they touch.
    const contentKeys = (...prefixes: string[]) => prefixes.map((prefix) => contentBucket.arnForObjects(`${prefix}*`));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'], // HeadObject of a finished upload, and the source of the copy into media/
      resources: contentKeys('pending/'),
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'], // /health: HeadObject of the published post list, nothing else
      resources: [contentBucket.arnForObjects('content/index.json')],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject', 's3:DeleteObject'], // presigned uploads, media copies, content JSON
      resources: contentKeys('pending/', 'media/', 'content/'),
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket'], // deleting a post's media; also makes a missing upload a 404 rather than a 403
      resources: [contentBucket.bucketArn],
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameters'], // lambda/api/config.js: one batch read of exactly these three
      resources: [`${PARAMETER_PREFIX}/entra-client-id`, `${PARAMETER_PREFIX}/entra-client-secret`, SHARED_TENANT_PARAMETER]
        .map((name) => this.formatArn({ service: 'ssm', resource: 'parameter', resourceName: name.slice(1) })),
    }));
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt'],
      resources: ['*'],
      conditions: { StringEquals: { 'kms:ViaService': `ssm.${this.region}.amazonaws.com` } },
    }));
    const functionUrl = apiHandler.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM });

    // ---------- Microsoft API (trusted tools and agents; see /docs/api.md) ----------
    let microsoftApiUrl: string | undefined;
    if (props.microsoftApi) {
      const tenantId = ssm.StringParameter.valueForStringParameter(this, SHARED_TENANT_PARAMETER);
      // The shared dliu API app is both the token audience and the only approved client (azp).
      const audience = ssm.StringParameter.valueForStringParameter(this, SHARED_API_APP_PARAMETER);
      const clientId = audience;
      const httpApi = new apigateway.HttpApi(this, 'MicrosoftApi', {
        description: 'Blog API: Microsoft Entra access tokens, delegated permissions and assigned users',
      });
      const authorizer = new authorizers.HttpJwtAuthorizer('MicrosoftJwt',
        Fn.join('', ['https://login.microsoftonline.com/', tenantId, '/v2.0']), { jwtAudience: [audience] });
      const integration = new integrations.HttpLambdaIntegration('BlogApi', apiHandler);
      for (const [route, permission] of Object.entries(apiRoutes)) {
        const [method, routePath] = route.split(' ');
        httpApi.addRoutes({
          path: routePath,
          methods: [apigateway.HttpMethod[method as 'GET' | 'POST' | 'PUT' | 'DELETE']],
          integration,
          authorizer,
          authorizationScopes: [permission.scope],
        });
      }
      // Caps what token-less or rejected-token floods can cost (see Denial of wallet in /docs#security).
      const stage = httpApi.defaultStage!.node.defaultChild as apigateway.CfnStage;
      stage.defaultRouteSettings = { throttlingRateLimit: MICROSOFT_API_RATE, throttlingBurstLimit: MICROSOFT_API_BURST };
      apiHandler.addEnvironment('API_GATEWAY_ID', httpApi.apiId);
      apiHandler.addEnvironment('API_TENANT_ID', tenantId);
      apiHandler.addEnvironment('API_AUDIENCE', audience);
      apiHandler.addEnvironment('API_CLIENT_ID', clientId);
      microsoftApiUrl = httpApi.apiEndpoint;
      new CfnOutput(this, 'MicrosoftApiUrl', { value: microsoftApiUrl });
    }

    // ---------- Website ----------
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    // The post-page handler reads index.html to add each post's link-preview tags.
    apiHandler.addToRolePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [siteBucket.arnForObjects('index.html')],
    }));
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
          // and videos from video.dliu.com. Every page loads the traffic monitor's page script, which
          // beacons to traffic.dliu.com. The shared dliu.com stylesheets come from files.dliu.com/dliu.com/ui/
          // (the DL icon there is already covered by img-src https:).
          contentSecurityPolicy: Fn.join('', [
            "default-src 'self'; script-src 'self' https://traffic.dliu.com; style-src 'self' https://files.dliu.com/dliu.com/ui/; object-src 'none'; ",
            "img-src 'self' data: blob: https:; media-src 'self' blob:; ",
            "connect-src 'self' https://traffic.dliu.com https://", contentBucket.bucketRegionalDomainName, '; ',
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
      // Adds x-blog-viewer (the reactions rate limit). Website sign-in only: bearer tokens go to the Microsoft API.
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

    // /health for status.dliu.com: keyed on nothing and forwarding nothing (no origin request policy, so no
    // cookies, no Authorization and no query string reach the Lambda), cached for the Lambda's max-age=60.
    const healthCache = new cloudfront.CachePolicy(this, 'HealthCache', {
      comment: 'blog.dliu.com /health, one copy for everyone',
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(60),
      maxTtl: Duration.seconds(60),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
    });
    const healthBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: healthCache,
      responseHeadersPolicy: headers,
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
        'health': healthBehavior,
      },
      domainNames: [domainName],
      certificate,
      defaultRootObject: 'index.html',
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // Readers are mostly in Europe and Asia: every edge location, and HTTP/3 for phones on mobile networks.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
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

    // Two uploads of web/, each syncing (and pruning) only its own files, and each invalidating /*.
    // Scripts, styles, images and docs/api.md: CloudFront keeps them a day (a deploy invalidates them),
    // browsers five minutes.
    // Pages load their scripts and styles as /<file>?v=<content hash> (see versioned-web.ts), so a new page
    // never runs a script still in the browser's cache from the previous deploy.
    const webAsset = s3deploy.Source.asset(stageVersionedWeb(path.join(ROOT, 'web')), { exclude: [API_DOC] });
    // docs/health.md has its own upload so it is served as text/markdown; charset=utf-8.
    const assets = new s3deploy.BucketDeployment(this, 'SiteContent', {
      sources: [
        webAsset,
        s3deploy.Source.data(API_DOC, fs.readFileSync(path.join(ROOT, 'web', API_DOC), 'utf8')
          .split(API_URL_PLACEHOLDER).join(microsoftApiUrl ?? '(the Microsoft API is not deployed)')),
      ],
      destinationBucket: siteBucket,
      exclude: ['*.html', HEALTH_DOC],
      distribution,
      distributionPaths: ['/*'],
      cacheControl: [s3deploy.CacheControl.fromString(STATIC_CACHE)],
    });
    // The HTML shells: browsers and CloudFront revalidate (cheap 304s), so a deploy takes effect on the
    // next load. Uploaded after the files they load.
    const pages = new s3deploy.BucketDeployment(this, 'SitePages', {
      sources: [webAsset],
      destinationBucket: siteBucket,
      exclude: ['*'],
      include: ['*.html'],
      distribution,
      distributionPaths: ['/*'],
      cacheControl: [s3deploy.CacheControl.noCache()],
    });
    pages.node.addDependency(assets);
    new s3deploy.BucketDeployment(this, 'HealthDoc', {
      sources: [webAsset],
      destinationBucket: siteBucket,
      exclude: ['*'],
      include: [HEALTH_DOC],
      distribution,
      distributionPaths: [`/${HEALTH_DOC}`],
      contentType: 'text/markdown; charset=utf-8',
      cacheControl: [s3deploy.CacheControl.fromString(STATIC_CACHE)],
    });

    // ---------- Automatic clearing of post media ----------
    // media/ is cached at CloudFront for a day. The app never overwrites a media key (a replaced file gets
    // a new ID, and saving copies the upload to a new key), but deleting a file or post, or changing media/
    // in the S3 console, would leave the old copy at the edge. Deletes, and uploads other than the app's
    // copies, are queued for a minute and cleared together, usually as one invalidation path.
    // Not cleared here: site files (each deploy clears /*), content/*.json (no-cache), pending/ (not served),
    // new media keys (never cached), and the logging buckets (not served).
    const mediaChanges = new sqs.Queue(this, 'MediaChanges', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      // After a day CloudFront's copy has expired anyway.
      retentionPeriod: Duration.days(1),
      visibilityTimeout: Duration.minutes(5),
    });
    new events.Rule(this, 'MediaChanged', {
      description: 'blog.dliu.com media deleted or changed outside the app',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Deleted', 'Object Created'],
        detail: {
          bucket: { name: [contentBucket.bucketName] },
          object: { key: [{ prefix: 'media/' }] },
          // The app's own media writes are copies to brand-new keys.
          reason: [{ 'anything-but': 'CopyObject' }],
        },
      },
      targets: [new eventTargets.SqsQueue(mediaChanges)],
    });
    const mediaInvalidator = new lambda.Function(this, 'MediaInvalidator', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(ROOT, 'lambda/invalidate')),
      timeout: Duration.seconds(30),
      memorySize: 128,
      description: 'blog.dliu.com clears CloudFront copies of deleted or changed media',
      environment: { DISTRIBUTION_ID: distribution.distributionId },
      logGroup: new logs.LogGroup(this, 'MediaInvalidatorLogs', {
        retention: logs.RetentionDays.THREE_MONTHS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    distribution.grantCreateInvalidation(mediaInvalidator);
    mediaInvalidator.addEventSource(new eventSources.SqsEventSource(mediaChanges, {
      batchSize: 1000,
      maxBatchingWindow: Duration.minutes(1),
      maxConcurrency: 2,
    }));

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
