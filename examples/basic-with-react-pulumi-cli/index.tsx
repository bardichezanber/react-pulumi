/**
 * Basic example with react-pulumi CLI.
 *
 *   react-pulumi up ./index.tsx      Deploy real @pulumi/random resources
 *   react-pulumi viz ./index.tsx     Interactive viz dashboard (resources stubbed)
 *
 * Uses @pulumi/random — no cloud credentials needed.
 */

import * as random from "@pulumi/random";
import { pulumiToComponent, VizButton, VizInput } from "@react-pulumi/core";
import { useState } from "react";

const [RandomPet] = pulumiToComponent(random.RandomPet);
const [RandomString] = pulumiToComponent(random.RandomString);
const [RandomInteger] = pulumiToComponent(random.RandomInteger);

export default function App() {
  const [petCount, setPetCount] = useState(2);
  const [nameLength, setNameLength] = useState(3);
  const [pwLength, setPwLength] = useState(16);
  const [pwSpecial, setPwSpecial] = useState(true);
  const [prefix, setPrefix] = useState("demo");

  return (
    <>
      {/* Dashboard controls */}
      <VizInput
        name="petCount"
        label="Pet Count"
        inputType="number"
        value={petCount}
        setValue={setPetCount}
        min={1}
        max={10}
      />
      <VizInput
        name="nameLength"
        label="Name Length"
        inputType="number"
        value={nameLength}
        setValue={setNameLength}
        min={1}
        max={10}
      />
      <VizInput
        name="pwLength"
        label="Password Length"
        inputType="number"
        value={pwLength}
        setValue={setPwLength}
        min={8}
        max={64}
      />
      <VizInput
        name="prefix"
        label="Name Prefix"
        inputType="text"
        value={prefix}
        setValue={setPrefix}
      />

      <VizButton
        name="add-pet"
        label="Add Pet (+1)"
        handler={() => setPetCount((n: number) => Math.min(10, n + 1))}
      />
      <VizButton
        name="remove-pet"
        label="Remove Pet (-1)"
        handler={() => setPetCount((n: number) => Math.max(1, n - 1))}
      />
      <VizButton
        name="toggle-special"
        label={`Special Chars: ${pwSpecial ? "ON" : "OFF"}`}
        handler={() => setPwSpecial((v: boolean) => !v)}
      />

      {/* Resources — count and props driven by state */}
      {Array.from({ length: petCount }, (_, i) => (
        <RandomPet key={`pet-${i}`} name={`${prefix}-pet-${i}`} length={nameLength} separator="-" />
      ))}

      <RandomString name={`${prefix}-password`} length={pwLength} special={pwSpecial} />

      <RandomInteger name={`${prefix}-port`} min={3000} max={9999} />
    </>
  );
}
