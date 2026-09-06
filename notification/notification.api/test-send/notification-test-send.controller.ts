import { Body, Controller, Inject, Post } from '@nestjs/common';
import { CurrentActor, RequiresAction, type Actor } from '../../../authorization/authorization.core';
import { NOTIFICATION_ACTIONS } from '../notification-api.options';
import { NotificationTestSendApiService } from './notification-test-send-api.service';
import type { TestSendBody } from '../dto/notification-api.dto';

/**
 * `POST /notifications/test-send` — fire a real notification via `Notifier`.
 * Gated on `notification.test_send`; tenant is the request actor's. Requires
 * `AuthorizationGuard` wired globally as `APP_GUARD`.
 */
@Controller('notifications')
export class NotificationTestSendController {
  constructor(@Inject(NotificationTestSendApiService) private readonly service: NotificationTestSendApiService) {}

  @Post('test-send')
  @RequiresAction(NOTIFICATION_ACTIONS.TEST_SEND)
  testSend(@CurrentActor() actor: Actor, @Body() body: TestSendBody) {
    return this.service.send(actor, body);
  }
}
