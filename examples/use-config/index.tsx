import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { pulumiToComponent, renderToPulumi, setPulumiSDK, useConfig } from "@react-pulumi/core";

setPulumiSDK(pulumi);

const [RandomPet] = pulumiToComponent(random.RandomPet);
const [RandomString] = pulumiToComponent(random.RandomString);

function App() {
  // Read config values — set via `pulumi config set <key> <value>`
  const petCount = Number(useConfig("petCount", "2"));
  const petLength = Number(useConfig("petLength", "3"));
  const pwLength = Number(useConfig("pwLength", "16"));
  const pwSpecial = useConfig("pwSpecial", "true") === "true";

  return (
    <>
      {Array.from({ length: petCount }, (_, i) => (
        <RandomPet key={`pet-${i}`} name={`pet-${i}`} length={petLength} />
      ))}
      <RandomString name="password" length={pwLength} special={pwSpecial} />
    </>
  );
}

renderToPulumi(App)();
