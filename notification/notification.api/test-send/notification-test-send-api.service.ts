import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Actor } from '../../../authorization/authorization.core';
import { NOTIFIER, type Notifier, type NotificationResult } from '../../notification.core';
import { NOTIFICATION_API_OPTIONS } from '../tokens';
import type { NotificationApiOptions } from '../notification-api.options';
import type { TestSendBody } from '../dto/notification-api.dto';

/**
 * `POST /notifications/test-send` — fire a real notification through `Notifier`,
 * so an admin can verify a route/template/credential actually works. The tenant
 * is the request actor's (a non-platform admin can't test another tenant's
 * config).
 */
@Injectable()
export class NotificationTestSendApiService {
  constructor(
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Inject(NOTIFICATION_API_OPTIONS) private readonly options: NotificationApiOptions,
  ) {}

  async send(actor: Actor, body: TestSendBody): Promise<NotificationResult> {
    if (!body?.notificationType || !body?.recipient) {
      throw new BadRequestException('recipient and notificationType are required');
    }

    let tenantId = actor.tenantId;
    if (body.tenantId !== undefined && body.tenantId !== actor.tenantId) {
      if (!(await this.options.isPlatformAdmin(actor))) {
        throw new ForbiddenException("cannot test-send against another tenant's configuration");
      }
      tenantId = body.tenantId;
    }

    return this.notifier.notify({
      recipient: body.recipient,
      notificationType: body.notificationType,
      variables: body.variables ?? {},
      tenantId,
    });
  }
}
