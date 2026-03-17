import * as random from "@pulumi/random";
import { pulumiToComponent } from "@react-pulumi/core";

// Wrap Pulumi resources as React components — returns [Component, Context]
const [RandomPet] = pulumiToComponent(random.RandomPet);
const [RandomString] = pulumiToComponent(random.RandomString);

// Export a component — react-pulumi CLI handles rendering + materialization
export default function App() {
  return (
    <>
      <RandomPet name="my-pet" length={3} />
      <RandomString name="my-password" length={16} special={true} />
    </>
  );
}
