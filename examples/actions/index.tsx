import * as random from "@pulumi/random";
import { Action, pulumiToComponent } from "@react-pulumi/core";

const [RandomPet] = pulumiToComponent(random.RandomPet);
const [RandomString] = pulumiToComponent(random.RandomString);

// A component that declares both infrastructure AND operational actions
function ApiService({ name, replicas = 2 }: { name: string; replicas?: number }) {
  return (
    <>
      {/* Infrastructure */}
      <RandomPet name={`${name}-id`} length={2} />
      <RandomString name={`${name}-secret`} length={32} special={true} />

      {/* Actions — surfaced in the viz dashboard as buttons */}
      <Action
        name={`${name}:rotate-secret`}
        description={`Rotate the API secret for ${name}`}
        handler={async () => {
          console.log(`[action] Rotating secret for ${name}...`);
          return { rotated: true };
        }}
      />
      <Action
        name={`${name}:scale`}
        description={`Scale ${name} replicas`}
        handler={async (count: unknown) => {
          console.log(`[action] Scaling ${name} to ${count} replicas`);
          return { replicas: count };
        }}
      />
    </>
  );
}

export default function App() {
  return (
    <>
      <ApiService name="auth-service" />
      <ApiService name="data-service" replicas={3} />

      {/* Global action */}
      <Action
        name="drain-all"
        description="Drain all services before maintenance"
        handler={async () => {
          console.log("[action] Draining all services...");
          return { drained: true };
        }}
      />
    </>
  );
}
