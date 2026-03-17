import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { pulumiToComponent, renderToPulumi, setPulumiSDK } from "@react-pulumi/core";
import { useState } from "react";

setPulumiSDK(pulumi);

// Wrap Pulumi resources as React components — returns [Component, Context]
const [RandomPet] = pulumiToComponent(random.RandomPet);
const [RandomString] = pulumiToComponent(random.RandomString);

// useState values persist to Pulumi.<stack>.yaml across `pulumi up` runs
function App() {
  const [petLength] = useState(3);
  const [pwLength] = useState(16);

  return (
    <>
      <RandomPet name="my-pet" length={petLength} />
      <RandomString name="my-password" length={pwLength} special={true} />
    </>
  );
}

// Standard Pulumi entry point — run with `pulumi up`
renderToPulumi(App)();
