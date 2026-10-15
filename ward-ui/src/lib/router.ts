// This file is part of Ward.
// Copyright (C) 2026 Ward contributors
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState } from "react";

// Hash-based routes keep the app a static site, and keep claim codes in the
// URL fragment, which browsers never send to a server.
export type Route =
  | { readonly name: "home" }
  | { readonly name: "fundraiser"; readonly billId: string }
  | { readonly name: "claim"; readonly claim: string }
  | { readonly name: "hospital" }
  | { readonly name: "operator" };

export const parseRoute = (hash: string): Route => {
  const [section, value] = hash.replace(/^#\/?/, "").split("/");
  if (section === "f" && value) return { name: "fundraiser", billId: value };
  if (section === "claim" && value) return { name: "claim", claim: value };
  if (section === "hospital") return { name: "hospital" };
  if (section === "operator") return { name: "operator" };
  return { name: "home" };
};

export const href = (route: Route): string => {
  switch (route.name) {
    case "home":
      return "#/";
    case "fundraiser":
      return `#/f/${route.billId}`;
    case "claim":
      return `#/claim/${route.claim}`;
    case "hospital":
      return "#/hospital";
    case "operator":
      return "#/operator";
  }
};

/** Absolute link, e.g. for sharing a fundraiser or handing a claim to a patient. */
export const absoluteHref = (route: Route): string =>
  `${window.location.origin}${window.location.pathname}${window.location.search}${href(route)}`;

export const navigate = (route: Route): void => {
  window.location.hash = href(route);
};

export const useRoute = (): Route => {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => {
      setRoute(parseRoute(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
};
