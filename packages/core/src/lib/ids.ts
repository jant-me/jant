import { fromString, typeidUnboxed } from "typeid-js";
import { z } from "zod";

export const ID_PREFIX = {
  site: "sit",
  siteDomain: "sdm",
  post: "pst",
  /** Shared key linking Posts that are translations of one another. */
  translationGroup: "tgr",
  media: "med",
  uploadSession: "upl",
  collection: "col",
  smartCollection: "smc",
  path: "pth",
  collectionDirectoryItem: "cdi",
  navItem: "nav",
  apiToken: "api",
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "vrf",
  telegramBinding: "tgb",
  telegramBindingCode: "tgc",
  telegramMediaGroupItem: "tmg",
  storagePurge: "spg",
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];
export type IdEntity = keyof typeof ID_PREFIX;

export const AUTH_ID_PREFIX = {
  user: ID_PREFIX.user,
  session: ID_PREFIX.session,
  account: ID_PREFIX.account,
  verification: ID_PREFIX.verification,
} as const;

const TYPE_ID_MESSAGE = "Invalid ID";

export function createTypeId(prefix: IdPrefix): string {
  return typeidUnboxed(prefix);
}

export function createEntityId(entity: IdEntity): string {
  return createTypeId(ID_PREFIX[entity]);
}

export function isTypeId(value: string, prefix?: IdPrefix): boolean {
  try {
    fromString(value, prefix);
    return true;
  } catch {
    return false;
  }
}

export function createTypeIdSchema(prefix?: IdPrefix) {
  return z.string().refine((value) => isTypeId(value, prefix), {
    message: TYPE_ID_MESSAGE,
  });
}
