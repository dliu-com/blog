import { App, CfnElement } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as fs from 'fs';
import * as path from 'path';
import { BlogStack, MICROSOFT_API_BURST, MICROSOFT_API_RATE, STATIC_CACHE } from '../lib/blog-stack';

const env = { account: '123456789012', region: 'eu-west-1' };
const template = Template.fromStack(new BlogStack(new App(), 'BlogSite', { env }));

test('posts table is keyed by post id, with no index, and is protected', () => {
  template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    BillingMode: 'PAY_PER_REQUEST',
    GlobalSecondaryIndexes: Match.absent(),
    Replicas: [Match.objectLike({
      DeletionProtectionEnabled: true,
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    })],
  });
  template.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Retain' });
});

test('only the posts and reactions tables remain; the retired API tokens table is gone', () => {
  template.resourceCountIs('AWS::DynamoDB::GlobalTable', 2);
  expect(Object.keys(template.findResources('AWS::DynamoDB::GlobalTable')).some((id) => id.startsWith('Tokens'))).toBe(false);
  expect(JSON.stringify(template.toJSON())).not.toContain('TOKENS_TABLE');
});

test('reactions have their own table (post or IP, then item), kept on delete, with rate-limit windows expiring by TTL', () => {
  template.hasResource('AWS::DynamoDB::GlobalTable', {
    DeletionPolicy: 'Retain',
    Properties: Match.objectLike({
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    }),
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: { Variables: Match.objectLike({ REACTIONS_TABLE: Match.anyValue() }) },
  });
});

test('nothing runs without traffic: one on-demand function, no servers', () => {
  template.resourceCountIs('AWS::EC2::Instance', 0);
  template.resourceCountIs('AWS::ECS::Service', 0);
  template.resourceCountIs('AWS::RDS::DBInstance', 0);
  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'index.handler',
    Runtime: 'nodejs22.x',
    ReservedConcurrentExecutions: 10,
    Environment: { Variables: Match.objectLike({ PARAMETER_PREFIX: '/blog', CONTENT_BUCKET: Match.anyValue(), TABLE_NAME: Match.anyValue() }) },
  });
  template.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'AWS_IAM' });
});

test('content bucket is private, kept, and expires abandoned uploads', () => {
  template.hasResource('AWS::S3::Bucket', {
    DeletionPolicy: 'Retain',
    Properties: Match.objectLike({
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedMethods: ['PUT'], AllowedHeaders: ['content-type'] })] },
      LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Prefix: 'pending/', ExpirationInDays: 1 })]) },
    }),
  });
});

test('api reads only its own parameters', () => {
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([Match.objectLike({
        Action: 'ssm:GetParameters',
        Resource: { 'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp(':parameter/blog/\\*$')])] },
      })]),
    },
  });
});

test('CloudFront routes the API, published content and media', () => {
  const [distribution] = Object.values(template.findResources('AWS::CloudFront::Distribution')) as any[];
  const config = distribution.Properties.DistributionConfig;
  expect(config.CacheBehaviors.map((b: any) => b.PathPattern)).toEqual(['api/*', 'auth/*', 'content/*', 'media/*', '20????????']);
  expect(config.CacheBehaviors.find((b: any) => b.PathPattern === 'content/*').AllowedMethods).toEqual(['GET', 'HEAD']);
  expect(config.CustomErrorResponses).toBeUndefined();
  expect(config.Logging).toEqual({ IncludeCookies: true });
  expect(config.DefaultCacheBehavior.FunctionAssociations.map((f: any) => f.EventType)).toEqual(['viewer-request', 'viewer-response']);
  // Site bucket, Lambda, content bucket, and the Lambda again as the post-page group's primary.
  expect(config.Origins).toHaveLength(4);
  // Post pages: the Lambda adds link-preview tags; the plain index.html is the fallback, cached per post ID.
  const posts = config.CacheBehaviors.find((b: any) => b.PathPattern === '20????????');
  expect(posts.AllowedMethods).toEqual(['GET', 'HEAD']);
  expect(posts.FunctionAssociations.map((f: any) => f.EventType)).toEqual(['viewer-request', 'viewer-response']);
  const [group] = config.OriginGroups.Items;
  expect(posts.TargetOriginId).toBe(group.Id);
  expect(group.FailoverCriteria.StatusCodes.Items).toEqual(expect.arrayContaining([403, 404, 500, 502, 503, 504]));
  const [primary, fallback] = group.Members.Items.map((m: any) => m.OriginId);
  const origin = (id: string) => config.Origins.find((o: any) => o.Id === id);
  const apiOrigin = origin(config.CacheBehaviors.find((b: any) => b.PathPattern === 'api/*').TargetOriginId);
  expect(origin(primary).DomainName).toEqual(apiOrigin.DomainName);
  expect(origin(primary).OriginAccessControlId).toEqual(apiOrigin.OriginAccessControlId);
  expect(fallback).toBe(config.DefaultCacheBehavior.TargetOriginId);
  template.hasResourceProperties('AWS::CloudFront::CachePolicy', {
    CachePolicyConfig: Match.objectLike({
      ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
        HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['x-blog-post'] },
        CookiesConfig: { CookieBehavior: 'none' },
      }),
    }),
  });
  // The viewer function (routing, x-blog-post, x-blog-viewer) runs on the API too.
  const api = config.CacheBehaviors.find((b: any) => b.PathPattern === 'api/*');
  expect(api.FunctionAssociations.map((f: any) => f.EventType)).toEqual(['viewer-request']);
  expect(api.FunctionAssociations[0].FunctionARN).toEqual(config.DefaultCacheBehavior.FunctionAssociations[0].FunctionARN);
  template.hasResourceProperties('AWS::CloudFront::Function', {
    FunctionConfig: Match.objectLike({ Runtime: 'cloudfront-js-2.0' }),
    FunctionCode: Match.stringLikeRegexp('/wp-admin'),
  });
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Action: 'lambda:InvokeFunction',
    Principal: 'cloudfront.amazonaws.com',
    InvokedViaFunctionUrl: true,
  });
});

test('every edge location, HTTP/3, and a day at the edge for site files but never the HTML shells', () => {
  const [distribution] = Object.values(template.findResources('AWS::CloudFront::Distribution')) as any[];
  expect(distribution.Properties.DistributionConfig.PriceClass).toBe('PriceClass_All');
  expect(distribution.Properties.DistributionConfig.HttpVersion).toBe('http2and3');
  const deployments = Object.values(template.findResources('Custom::CDKBucketDeployment')) as any[];
  expect(deployments).toHaveLength(2);
  const assets = deployments.find((d) => d.Properties.Exclude);
  const pages = deployments.find((d) => d.Properties.Include);
  expect(assets.Properties).toMatchObject({ Exclude: ['*.html'], Prune: true, DistributionPaths: ['/*'],
    SystemMetadata: { 'cache-control': STATIC_CACHE } });
  expect(assets.Properties.Include).toBeUndefined();
  expect(STATIC_CACHE).toBe('public, max-age=300, s-maxage=86400, stale-while-revalidate=86400');
  expect(pages.Properties).toMatchObject({ Exclude: ['*'], Include: ['*.html'], Prune: true, DistributionPaths: ['/*'],
    SystemMetadata: { 'cache-control': 'no-cache' } });
  expect(pages.DependsOn).toEqual(expect.arrayContaining([Object.entries(template.findResources('Custom::CDKBucketDeployment'))
    .find(([, d]: any) => d.Properties.Exclude && !d.Properties.Include)![0]]));
  // Content JSON is not invalidated on publish and media is deleted with posts: neither gets the longer cache.
  expect(fs.readFileSync(path.join(__dirname, '..', 'lambda', 'api', 's3.js'), 'utf8')).toMatch(/MEDIA_CACHE = 'public, max-age=86400';\nconst CONTENT_CACHE = 'no-cache';/);
});

test('deleted or changed media is cleared from CloudFront, through a one-minute queue, by a function that can only invalidate this site', () => {
  const ref = (type: string) => ({ Ref: Object.keys(template.findResources(type))[0] });
  const buckets = template.findResources('AWS::S3::Bucket');
  const content = Object.keys(buckets).find((id) => id.startsWith('ContentBucket'))!;
  // Only the content bucket sends events; the site bucket is cleared by each deploy.
  template.hasResourceProperties('Custom::S3BucketNotifications', {
    BucketName: { Ref: content },
    NotificationConfiguration: { EventBridgeConfiguration: {} },
  });
  template.resourceCountIs('Custom::S3BucketNotifications', 1);
  template.resourceCountIs('AWS::Events::Rule', 1);
  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: {
      source: ['aws.s3'],
      'detail-type': ['Object Deleted', 'Object Created'],
      detail: {
        bucket: { name: [{ Ref: content }] },
        object: { key: [{ prefix: 'media/' }] },
        reason: [{ 'anything-but': 'CopyObject' }],
      },
    },
    Targets: [Match.objectLike({ Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('^MediaChanges'), 'Arn'] } })],
  });
  template.hasResourceProperties('AWS::SQS::Queue', { MessageRetentionPeriod: 86400, SqsManagedSseEnabled: true });
  template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
    BatchSize: 1000, MaximumBatchingWindowInSeconds: 60, ScalingConfig: { MaximumConcurrency: 2 },
  });
  const [, fn] = Object.entries(template.findResources('AWS::Lambda::Function'))
    .find(([id]) => id.startsWith('MediaInvalidator'))! as any;
  expect(fn.Properties.Environment.Variables.DISTRIBUTION_ID).toEqual(ref('AWS::CloudFront::Distribution'));
  const role = fn.Properties.Role['Fn::GetAtt'][0];
  const policies = Object.values(template.findResources('AWS::IAM::Policy'))
    .filter((p: any) => p.Properties.Roles.some((r: any) => r.Ref === role)) as any[];
  const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
  const invalidate = statements.filter((st) => ([] as string[]).concat(st.Action).includes('cloudfront:CreateInvalidation'));
  expect(invalidate).toHaveLength(1);
  expect(JSON.stringify(invalidate[0].Resource)).toContain(':distribution/');
  expect(JSON.stringify(invalidate[0].Resource)).toContain(ref('AWS::CloudFront::Distribution').Ref);
  expect(statements.flatMap((st) => ([] as string[]).concat(st.Action)).every((a: string) => a === 'cloudfront:CreateInvalidation' || a.startsWith('sqs:'))).toBe(true);
});

test('security headers allow the blog to be indexed', () => {
  const [policy] = Object.values(template.findResources('AWS::CloudFront::ResponseHeadersPolicy')) as any[];
  const config = policy.Properties.ResponseHeadersPolicyConfig;
  expect(JSON.stringify(config.SecurityHeadersConfig.ContentSecurityPolicy)).toContain("script-src 'self' https://traffic.dliu.com;");
  expect(JSON.stringify(config.SecurityHeadersConfig.ContentSecurityPolicy)).toContain("connect-src 'self' https://traffic.dliu.com https://");
  expect(JSON.stringify(config.CustomHeadersConfig)).not.toContain('X-Robots-Tag');
});

test('pages may load only the shared dliu.com stylesheet folder from files.dliu.com, and no shared scripts', () => {
  const [policy] = Object.values(template.findResources('AWS::CloudFront::ResponseHeadersPolicy')) as any[];
  const csp = JSON.stringify(policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy);
  expect(csp).toContain("style-src 'self' https://files.dliu.com/dliu.com/ui/;");
  expect(csp).toContain("img-src 'self' data: blob: https:;");
  expect(csp).not.toMatch(/script-src[^;]*files\.dliu\.com/);
});

test('traffic logging can be turned off', () => {
  const quiet = Template.fromStack(new BlogStack(new App(), 'Quiet', { env, trafficLogging: false }));
  const [distribution] = Object.values(quiet.findResources('AWS::CloudFront::Distribution')) as any[];
  expect(distribution.Properties.DistributionConfig.Logging).toBeUndefined();
  expect(distribution.Properties.DistributionConfig.DefaultCacheBehavior.FunctionAssociations).toHaveLength(1);
});

describe('managed Microsoft API', () => {
  const app = new App();
  const stack = new BlogStack(app, 'Managed', { env, microsoftApi: true });
  const managed = Template.fromStack(stack);
  const routes = require('../lambda/api/routes.json');

  test('an HTTP API with a Microsoft v2 JWT authorizer from SSM, and exactly the nine scoped routes', () => {
    managed.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    managed.hasResourceProperties('AWS::ApiGatewayV2::Api', { ProtocolType: 'HTTP' });
    managed.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
      JwtConfiguration: {
        Audience: [{ Ref: Match.stringLikeRegexp('blogapiaudience') }],
        Issuer: { 'Fn::Join': ['', ['https://login.microsoftonline.com/', { Ref: Match.stringLikeRegexp('blogapitenantid') }, '/v2.0']] },
      },
    });
    const parameters = JSON.stringify(managed.toJSON().Parameters);
    for (const name of ['/blog/api-tenant-id', '/blog/api-audience', '/blog/api-client-id']) expect(parameters).toContain(name);
    const deployed = Object.values(managed.findResources('AWS::ApiGatewayV2::Route')).map((route: any) => route.Properties);
    expect(Object.fromEntries(deployed.map((route: any) => [route.RouteKey, route.AuthorizationScopes])))
      .toEqual(Object.fromEntries(Object.entries(routes).map(([key, value]: [string, any]) => [key, [value.scope]])));
    for (const route of deployed) expect(route.AuthorizationType).toBe('JWT');
    expect(deployed.map((route: any) => route.RouteKey)).not.toContain('$default');
  });

  test('the function gets the gateway, tenant, audience and client; the URL is an output and goes into the API guide', () => {
    managed.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({
        API_GATEWAY_ID: { Ref: Match.stringLikeRegexp('^MicrosoftApi') },
        API_TENANT_ID: Match.anyValue(), API_AUDIENCE: Match.anyValue(), API_CLIENT_ID: Match.anyValue(),
      }) },
    });
    managed.hasOutput('MicrosoftApiUrl', {});
    const deployment = Object.values(managed.findResources('Custom::CDKBucketDeployment'))
      .find((resource: any) => resource.Properties.SourceMarkers) as any;
    const markers = Object.values(Object.assign({}, ...deployment.Properties.SourceMarkers));
    const api = stack.getLogicalId(stack.node.findChild('MicrosoftApi').node.defaultChild as CfnElement);
    // Both {{MICROSOFT_API_URL}} placeholders in docs/api.md become the deployed endpoint.
    expect(markers).toEqual([{ 'Fn::GetAtt': [api, 'ApiEndpoint'] }, { 'Fn::GetAtt': [api, 'ApiEndpoint'] }]);
  });

  test('without it, there is no gateway and the guide says so', () => {
    template.resourceCountIs('AWS::ApiGatewayV2::Api', 0);
    expect(JSON.stringify(template.toJSON())).not.toContain('API_GATEWAY_ID');
  });

  test('the whole stage is throttled, which caps what a flood of requests can cost', () => {
    managed.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: MICROSOFT_API_RATE, ThrottlingBurstLimit: MICROSOFT_API_BURST },
    });
    expect(MICROSOFT_API_RATE).toBeLessThanOrEqual(10);
    expect(MICROSOFT_API_BURST).toBeLessThanOrEqual(20);
  });
});

test('the API function logs only warnings and errors from the platform, not a line per call', () => {
  const [, fn] = Object.entries(template.findResources('AWS::Lambda::Function'))
    .find(([id]) => id.startsWith('ApiHandler'))! as any;
  expect(fn.Properties.LoggingConfig).toMatchObject({ LogFormat: 'JSON', SystemLogLevel: 'WARN', ApplicationLogLevel: 'INFO' });
});

test('the API function has least-privilege S3 access: named actions on the prefixes it uses, nothing on other buckets', () => {
  const [, fn] = Object.entries(template.findResources('AWS::Lambda::Function'))
    .find(([id]) => id.startsWith('ApiHandler'))! as any;
  const role = fn.Properties.Role['Fn::GetAtt'][0];
  const statements = (Object.values(template.findResources('AWS::IAM::Policy')) as any[])
    .filter((p) => p.Properties.Roles.some((r: any) => r.Ref === role))
    .flatMap((p) => p.Properties.PolicyDocument.Statement);
  const s3 = statements.filter((st) => ([] as string[]).concat(st.Action).some((a) => a.startsWith('s3:')));
  const actions = s3.flatMap((st) => ([] as string[]).concat(st.Action));
  expect(actions.every((a) => !a.includes('*'))).toBe(true);
  expect(new Set(actions)).toEqual(new Set(['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:ListBucket']));
  const content = JSON.stringify(s3.filter((st) => JSON.stringify(st.Resource).includes('ContentBucket')).map((st) => st.Resource));
  for (const prefix of ['pending/*', 'media/*', 'content/*']) expect(content).toContain(prefix);
  expect(content).not.toMatch(/"\/\*"/);
  // The only site-bucket access is reading index.html, the page template.
  const site = s3.filter((st) => JSON.stringify(st.Resource).includes('SiteBucket'));
  expect(site.flatMap((st) => ([] as string[]).concat(st.Action)).every((a) => a === 's3:GetObject')).toBe(true);
  expect(JSON.stringify(site)).toContain('/index.html');
  const wildcard = statements.filter((st) => ([] as string[]).concat(st.Resource).includes('*'));
  expect(wildcard).toEqual([expect.objectContaining({ Action: 'kms:Decrypt', Condition: { StringEquals: { 'kms:ViaService': 'ssm.eu-west-1.amazonaws.com' } } })]);
});

test('every log group the stack manages is kept three months (90 days)', () => {
  const groups = Object.values(template.findResources('AWS::Logs::LogGroup')) as any[];
  expect(groups.length).toBe(2);
  for (const g of groups) expect(g.Properties.RetentionInDays).toBe(90);
  expect(Object.keys(template.findResources('Custom::LogRetention'))).toEqual([]);
});
