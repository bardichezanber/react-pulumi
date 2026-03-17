/**
 * Intercepts React's internal useState dispatcher to hydrate values
 * from persisted state and track mutations.
 *
 * Uses a Proxy on React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H
 * to wrap useState while leaving all other hooks untouched.
 */

import React from "react";
import { getNextValue, trackValue } from "./state-store.js";

// React 19 internals accessor
const INTERNALS_KEY = "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE";

interface ReactDispatcher {
  useState: <T>(initialState: T | (() => T)) => [T, (value: T | ((prev: T) => T)) => void];
  [key: string]: unknown;
}

interface ReactInternals {
  H: ReactDispatcher | null;
  [key: string]: unknown;
}

/**
 * Install the useState interceptor. Returns a cleanup function
 * that restores the original behavior.
 */
export function installInterceptor(): () => void {
  const internals = (React as unknown as Record<string, unknown>)[INTERNALS_KEY] as
    | ReactInternals
    | undefined;

  if (!internals) {
    throw new Error(
      "[react-pulumi] Cannot access React internals. " +
        "This requires React 19 with __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.",
    );
  }

  const originalDescriptor = Object.getOwnPropertyDescriptor(internals, "H");
  let currentDispatcher = internals.H;

  // Create a proxy that wraps the dispatcher's useState
  function wrapDispatcher(dispatcher: ReactDispatcher | null): ReactDispatcher | null {
    if (!dispatcher) return null;

    return new Proxy(dispatcher, {
      get(target, prop, receiver) {
        if (prop === "useState") {
          return function useStateIntercepted<T>(
            initialState: T | (() => T),
          ): [T, (value: T | ((prev: T) => T)) => void] {
            // Resolve the default if it's a function
            const defaultValue =
              typeof initialState === "function" ? (initialState as () => T)() : initialState;

            const { index, value } = getNextValue(defaultValue);

            // Call the real useState with our hydrated value
            const [, originalSetter] = target.useState(value as T);

            // Wrap the setter to track value changes
            const wrappedSetter = (newValue: T | ((prev: T) => T)) => {
              const resolved =
                typeof newValue === "function"
                  ? (newValue as (prev: T) => T)(value as T)
                  : newValue;
              trackValue(index, resolved);
              originalSetter(resolved);
            };

            return [value as T, wrappedSetter];
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  // Use a proxy on internals to intercept H access
  Object.defineProperty(internals, "H", {
    configurable: true,
    get() {
      return wrapDispatcher(currentDispatcher);
    },
    set(newDispatcher: ReactDispatcher | null) {
      currentDispatcher = newDispatcher;
    },
  });

  // Return cleanup function
  return () => {
    if (originalDescriptor) {
      Object.defineProperty(internals, "H", originalDescriptor);
    } else {
      internals.H = currentDispatcher;
    }
  };
}
