import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { BlogStack } from '../lib/blog-stack';

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

test('API tokens have their own table, with expiry by TTL', () => {
  template.resourceCountIs('AWS::DynamoDB::GlobalTable', 2);
  template.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
  });
  template.hasResourceProperties('AWS::Lambda::Function', {
    Environment: { Variables: Match.objectLike({ TOKENS_TABLE: Match.anyValue() }) },
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
  expect(config.CacheBehaviors.map((b: any) => b.PathPattern)).toEqual(['api/*', 'auth/*', 'content/*', 'media/*']);
  expect(config.CacheBehaviors.find((b: any) => b.PathPattern === 'content/*').AllowedMethods).toEqual(['GET', 'HEAD']);
  expect(config.CustomErrorResponses).toBeUndefined();
  expect(config.Logging).toEqual({ IncludeCookies: true });
  expect(config.DefaultCacheBehavior.FunctionAssociations.map((f: any) => f.EventType)).toEqual(['viewer-request', 'viewer-response']);
  expect(config.Origins).toHaveLength(3);
  // The viewer function copies Authorization: Bearer to x-blog-token before CloudFront signs for Lambda.
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

test('security headers allow the blog to be indexed', () => {
  const [policy] = Object.values(template.findResources('AWS::CloudFront::ResponseHeadersPolicy')) as any[];
  const config = policy.Properties.ResponseHeadersPolicyConfig;
  expect(JSON.stringify(config.SecurityHeadersConfig.ContentSecurityPolicy)).toContain("script-src 'self'");
  expect(JSON.stringify(config.CustomHeadersConfig)).not.toContain('X-Robots-Tag');
});

test('traffic logging can be turned off', () => {
  const quiet = Template.fromStack(new BlogStack(new App(), 'Quiet', { env, trafficLogging: false }));
  const [distribution] = Object.values(quiet.findResources('AWS::CloudFront::Distribution')) as any[];
  expect(distribution.Properties.DistributionConfig.Logging).toBeUndefined();
  expect(distribution.Properties.DistributionConfig.DefaultCacheBehavior.FunctionAssociations).toHaveLength(1);
});
