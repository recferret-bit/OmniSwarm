// The `nearai` family: the NEAR AI Cloud entry of the provider catalog (packages/schemas/providers.mjs).
// TEE attestation (W03-22, the "Verified" panel) is not part of this family yet.
import { singleProviderFamily } from './provider-api-launch.mjs';

export const family = singleProviderFamily('nearai');
