import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { LICENSE_HEADER } from '../licensing/license-token.service';
import { LicensingService } from '../licensing/licensing.service';

export interface AuthenticatedDevice {
  id: string;
  orgId: string;
}

// For endpoints a desktop device calls in the background with no user
// session (snapshot, number blocks, user sessions for replay): the license
// token is the credential, and the device row must still be active.
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly licensing: LicensingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const device = await this.licensing.authenticateDevice(String(req.headers[LICENSE_HEADER] ?? ''));
    req.device = { id: device.id, orgId: device.orgId } satisfies AuthenticatedDevice;
    return true;
  }
}
