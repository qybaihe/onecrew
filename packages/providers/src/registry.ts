import type { ProviderCapability, ProviderRequest, ProviderRoute } from '@onecrew/contracts';

import { ProviderRouteError } from './errors.js';
import type { AnyProviderJob, ProviderJob } from './types.js';

type CapabilityRoutes = Record<ProviderRoute, AnyProviderJob>;

export class ProviderRegistry {
  private readonly routes = new Map<ProviderCapability, CapabilityRoutes>();

  register<I extends ProviderRequest, O>(provider: ProviderJob<I, O>): void {
    const descriptor = provider.descriptor;
    const existing = this.routes.get(descriptor.capability) ?? ({} as Partial<CapabilityRoutes>);
    if (existing[descriptor.route]) {
      throw new ProviderRouteError(
        `Duplicate ${descriptor.capability}/${descriptor.route} provider route`,
      );
    }
    existing[descriptor.route] = provider as unknown as AnyProviderJob;
    this.routes.set(descriptor.capability, existing as CapabilityRoutes);
  }

  get(capability: ProviderCapability, route: ProviderRoute): AnyProviderJob {
    const provider = this.routes.get(capability)?.[route];
    if (!provider) throw new ProviderRouteError(`No provider for ${capability}/${route}`);
    return provider;
  }

  assertComplete(): void {
    const capabilities: ProviderCapability[] = ['llm', 'image', 'video', 'tts', 'vlm'];
    for (const capability of capabilities) {
      for (const route of ['primary', 'fallback'] as const) this.get(capability, route);
    }
  }

  describe(): Array<AnyProviderJob['descriptor']> {
    return [...this.routes.values()]
      .flatMap((routes) => [routes.primary.descriptor, routes.fallback.descriptor])
      .sort((left, right) => `${left.capability}/${left.route}`.localeCompare(`${right.capability}/${right.route}`));
  }
}
