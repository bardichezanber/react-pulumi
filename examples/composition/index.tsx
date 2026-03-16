import React from "react";
import { pulumiToComponent } from "@react-pulumi/core";
import * as random from "@pulumi/random";

const [RandomPet] = pulumiToComponent(random.RandomPet);
const [RandomString] = pulumiToComponent(random.RandomString);
const [RandomId] = pulumiToComponent(random.RandomId);

// Reusable component: a "service" with a unique ID and API key
function Service({ serviceName, keyLength = 32 }: { serviceName: string; keyLength?: number }) {
  return (
    <>
      <RandomId name={`${serviceName}-id`} byteLength={8} />
      <RandomString name={`${serviceName}-api-key`} length={keyLength} special={false} />
    </>
  );
}

// Reusable component: an "environment" that groups resources
function Environment({ env, children }: { env: string; children: React.ReactNode }) {
  return (
    <>
      <RandomPet name={`${env}-namespace`} length={2} prefix={env} />
      {children}
    </>
  );
}

// Compose them together
export default function App() {
  return (
    <>
      <Environment env="staging">
        <Service serviceName="staging-auth" />
        <Service serviceName="staging-api" keyLength={64} />
      </Environment>

      <Environment env="production">
        <Service serviceName="prod-auth" />
        <Service serviceName="prod-api" keyLength={64} />
        <Service serviceName="prod-worker" />
      </Environment>
    </>
  );
}
