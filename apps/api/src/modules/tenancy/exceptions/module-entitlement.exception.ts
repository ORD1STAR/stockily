import { HttpException, HttpStatus } from '@nestjs/common';

// 402 (not 403): distinguishes "you'd need to activate/pay for this module"
// from a plain permission denial, so the frontend can show an upgrade CTA
// instead of a generic forbidden message (docs/Action Plan.md §4).
export class ModuleEntitlementException extends HttpException {
  constructor(moduleKey: string) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'module_entitlement_required',
        moduleKey,
        message: `Le module « ${moduleKey} » n'est pas actif (ou son essai a expiré) pour cette organisation.`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
