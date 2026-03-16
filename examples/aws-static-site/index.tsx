import React from "react";
import { pulumiToComponent } from "@react-pulumi/core";
import * as aws from "@pulumi/aws";

const [AwsProvider] = pulumiToComponent(aws.Provider);
const [Bucket] = pulumiToComponent(aws.s3.BucketV2);
const [BucketWebsite] = pulumiToComponent(aws.s3.BucketWebsiteConfigurationV2);
const [BucketPublicAccess] = pulumiToComponent(aws.s3.BucketPublicAccessBlock);
const [BucketObject] = pulumiToComponent(aws.s3.BucketObjectv2);

// Reusable component: a static website bucket
function StaticSite({ siteName }: { siteName: string }) {
  return (
    <>
      <Bucket name={`${siteName}-bucket`} />

      <BucketWebsite
        name={`${siteName}-website-config`}
        bucket={`${siteName}-bucket`}
        indexDocument={{ suffix: "index.html" }}
        errorDocument={{ key: "error.html" }}
      />

      <BucketPublicAccess
        name={`${siteName}-public-access`}
        bucket={`${siteName}-bucket`}
        blockPublicAcls={false}
        blockPublicPolicy={false}
      />

      <BucketObject
        name={`${siteName}-index`}
        bucket={`${siteName}-bucket`}
        key="index.html"
        contentType="text/html"
        content="<html><body><h1>Hello from react-pulumi!</h1></body></html>"
      />

      <BucketObject
        name={`${siteName}-error`}
        bucket={`${siteName}-bucket`}
        key="error.html"
        contentType="text/html"
        content="<html><body><h1>404 - Not Found</h1></body></html>"
      />
    </>
  );
}

export default function App() {
  return (
    <>
      {/* Primary site in us-west-2 */}
      <AwsProvider name="us-west" region="us-west-2">
        <StaticSite siteName="my-site" />
      </AwsProvider>

      {/* DR replica in us-east-1 */}
      <AwsProvider name="us-east" region="us-east-1">
        <StaticSite siteName="my-site-dr" />
      </AwsProvider>
    </>
  );
}
