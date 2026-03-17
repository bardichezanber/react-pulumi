import { pulumiToComponent } from "@react-pulumi/core";
import type React from "react";

// Mock resource class — stands in for real Pulumi resources so we can
// visualize the tree without installing any cloud provider SDK.
class MockResource {
  name: string;
  args: Record<string, unknown>;
  opts?: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts;
  }
}

// Mock provider class
class MockAwsProvider {
  static __pulumiType = "pulumi:providers:aws";
  name: string;
  args: Record<string, unknown>;
  opts?: Record<string, unknown>;
  constructor(name: string, args: Record<string, unknown>, opts?: Record<string, unknown>) {
    this.name = name;
    this.args = args;
    this.opts = opts;
  }
}

// Register mock resources with realistic AWS type tokens
const [AwsProvider] = pulumiToComponent(MockAwsProvider);
const [Vpc] = pulumiToComponent(MockResource, "aws:ec2/vpc:Vpc");
const [Subnet] = pulumiToComponent(MockResource, "aws:ec2/subnet:Subnet");
const [SecurityGroup] = pulumiToComponent(MockResource, "aws:ec2/securityGroup:SecurityGroup");
const [Instance] = pulumiToComponent(MockResource, "aws:ec2/instance:Instance");
const [RdsInstance] = pulumiToComponent(MockResource, "aws:rds/instance:Instance");
const [CacheCluster] = pulumiToComponent(MockResource, "aws:elasticache/cluster:Cluster");
const [Bucket] = pulumiToComponent(MockResource, "aws:s3/bucketV2:BucketV2");

// Reusable components
function WebTier({ env }: { env: string }) {
  return (
    <>
      <SecurityGroup name={`${env}-web-sg`} />
      <Instance name={`${env}-web-1`} />
      <Instance name={`${env}-web-2`} />
    </>
  );
}

function DataTier({ env }: { env: string }) {
  return (
    <>
      <SecurityGroup name={`${env}-data-sg`} />
      <RdsInstance name={`${env}-db`} opts={{ protect: true }} />
      <CacheCluster name={`${env}-cache`} />
    </>
  );
}

function Network({ env, children }: { env: string; children: React.ReactNode }) {
  return (
    <Vpc name={`${env}-vpc`}>
      <Subnet name={`${env}-public-1`} />
      <Subnet name={`${env}-public-2`} />
      <Subnet name={`${env}-private-1`} />
      <Subnet name={`${env}-private-2`} />
      {children}
    </Vpc>
  );
}

// Full 3-tier architecture with provider nesting
export default function App() {
  return (
    <AwsProvider name="us-west" region="us-west-2">
      <Bucket name="app-assets" />

      <Network env="prod">
        <WebTier env="prod" />
        <DataTier env="prod" />
      </Network>

      <AwsProvider name="us-east" region="us-east-1">
        <Bucket name="dr-backup" opts={{ protect: true }} />
      </AwsProvider>
    </AwsProvider>
  );
}
