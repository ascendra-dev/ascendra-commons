import type {
  ChannelRouteView,
  ConfigScope,
  DeleteChannelRouteInput,
  DeleteProviderCredentialInput,
  DeleteTemplateInput,
  ProviderCredentialView,
  SetChannelRouteInput,
  SetProviderCredentialInput,
  SetTemplateInput,
  TemplateView,
} from './notification-admin.types';

/**
 * CRUD on the routing / template / provider-credential config for a notification
 * admin screen. Bound under `NOTIFICATION_CONFIG_ADMIN_PORT` by a stack adapter;
 * consumed by `notification.api`.
 *
 * `tenantId` NULL = the deployment default (platform-admin territory in
 * `notification.api`). A `scope` narrows a list to the defaults plus one tenant's rows. Provider-credential *values* are never returned by
 * `listProviderCredentials` — they hold secrets. Audit is `notification.api`'s
 * to wire.
 */
export interface NotificationConfigAdminPort {
  setChannelRoute(input: SetChannelRouteInput): Promise<void>;
  deleteChannelRoute(input: DeleteChannelRouteInput): Promise<void>;
  listChannelRoutes(scope?: ConfigScope): Promise<ChannelRouteView[]>;

  setTemplate(input: SetTemplateInput): Promise<void>;
  deleteTemplate(input: DeleteTemplateInput): Promise<void>;
  listTemplates(scope?: ConfigScope): Promise<TemplateView[]>;

  setProviderCredential(input: SetProviderCredentialInput): Promise<void>;
  deleteProviderCredential(input: DeleteProviderCredentialInput): Promise<void>;
  listProviderCredentials(scope?: ConfigScope): Promise<ProviderCredentialView[]>;
}
