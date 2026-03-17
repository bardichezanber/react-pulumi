import * as random from "@pulumi/random";
import { Group, pulumiToComponent } from "@react-pulumi/core";

const [RandomPet] = pulumiToComponent(random.RandomPet);
const [RandomString] = pulumiToComponent(random.RandomString);
const [RandomId] = pulumiToComponent(random.RandomId);

// ──────────────────────────────────────────────────────────────
// TRANSPARENT component — no Pulumi footprint, just code organization.
// Renaming this component has ZERO infrastructure impact.
// ──────────────────────────────────────────────────────────────
function Credentials({ prefix }: { prefix: string }) {
  return (
    <>
      <RandomString name={`${prefix}-api-key`} length={32} special={false} />
      <RandomString name={`${prefix}-secret`} length={64} special={true} />
    </>
  );
}

// ──────────────────────────────────────────────────────────────
// GROUP component — creates a Pulumi ComponentResource.
// Children get scoped URNs and appear grouped in `pulumi stack`.
// ⚠️  Renaming the `type` will change all child URNs!
// ──────────────────────────────────────────────────────────────
function Service({ serviceName }: { serviceName: string }) {
  return (
    <Group type="custom:component:Service" name={`${serviceName}-svc`}>
      <RandomPet name={`${serviceName}-id`} length={2} />
      <RandomId name={`${serviceName}-uid`} byteLength={8} />
      {/* Credentials is transparent — nested inside the Group */}
      <Credentials prefix={serviceName} />
    </Group>
  );
}

// ──────────────────────────────────────────────────────────────
// Mix both patterns freely
// ──────────────────────────────────────────────────────────────
export default function App() {
  return (
    <>
      {/* Top-level ungrouped resource with opts */}
      <RandomPet name="project-name" length={3} opts={{ protect: true }} />

      {/* Each Service is a ComponentResource group */}
      <Service serviceName="auth" />
      <Service serviceName="api" />
    </>
  );
}
