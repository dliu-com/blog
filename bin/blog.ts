#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { BlogStack } from '../lib/blog-stack';

const region = process.env.CDK_DEFAULT_REGION || 'eu-west-1';
// Imports the DNS and TrafficMonitor exports, which live in eu-west-1.
if (region !== 'eu-west-1') throw new Error('BlogSite must be deployed to eu-west-1.');

const app = new App();
new BlogStack(app, 'BlogSite', {
  subdomain: app.node.tryGetContext('subdomain') || 'blog',
  trafficLogging: app.node.tryGetContext('trafficLogging') !== 'false',
  tags: { service: 'blog' },
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});
