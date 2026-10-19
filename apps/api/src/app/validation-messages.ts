import { BadRequestException } from '@nestjs/common';
import { ValidationError } from 'class-validator';

// class-validator's default constraint messages are English ("name should
// not be empty") and ApiError on the frontend surfaces body.message verbatim
// in error banners — so without this, every form validation error the user
// sees is in English regardless of the rest of the (French) UI. Mapping by
// constraint key rather than parsing the English text keeps this correct
// even if class-validator's own wording changes upstream.
const CONSTRAINT_MESSAGES: Record<string, (field: string) => string> = {
  isNotEmpty: (f) => `Le champ « ${f} » est requis.`,
  isDefined: (f) => `Le champ « ${f} » est requis.`,
  minLength: (f) => `Le champ « ${f} » est trop court.`,
  maxLength: (f) => `Le champ « ${f} » est trop long.`,
  isString: (f) => `Le champ « ${f} » doit être une chaîne de caractères.`,
  isEmail: (f) => `Le champ « ${f} » doit être une adresse email valide.`,
  isInt: (f) => `Le champ « ${f} » doit être un nombre entier.`,
  isNumber: (f) => `Le champ « ${f} » doit être un nombre.`,
  isBoolean: (f) => `Le champ « ${f} » doit être vrai ou faux.`,
  isArray: (f) => `Le champ « ${f} » doit être une liste.`,
  arrayNotEmpty: (f) => `Le champ « ${f} » ne peut pas être vide.`,
  arrayMinSize: (f) => `Le champ « ${f} » n'a pas assez d'éléments.`,
  isEnum: (f) => `La valeur du champ « ${f} » n'est pas valide.`,
  isDateString: (f) => `Le champ « ${f} » doit être une date valide.`,
  isUUID: (f) => `Le champ « ${f} » n'est pas un identifiant valide.`,
  isPositive: (f) => `Le champ « ${f} » doit être un nombre positif.`,
  min: (f) => `Le champ « ${f} » est inférieur au minimum autorisé.`,
  max: (f) => `Le champ « ${f} » dépasse le maximum autorisé.`,
  matches: (f) => `Le format du champ « ${f} » n'est pas valide.`,
  isIn: (f) => `La valeur du champ « ${f} » n'est pas autorisée.`,
  whitelistValidation: (f) => `Le champ « ${f} » n'est pas autorisé.`,
  isUrl: (f) => `Le champ « ${f} » doit être une URL valide.`,
};

function translate(error: ValidationError, parentPath = ''): string[] {
  const field = parentPath ? `${parentPath}.${error.property}` : error.property;
  const messages: string[] = [];
  if (error.constraints) {
    for (const key of Object.keys(error.constraints)) {
      const translator = CONSTRAINT_MESSAGES[key];
      messages.push(translator ? translator(field) : `Le champ « ${field} » est invalide.`);
    }
  }
  for (const child of error.children ?? []) {
    messages.push(...translate(child, field));
  }
  return messages;
}

export function frenchValidationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const message = errors.flatMap((error) => translate(error));
  return new BadRequestException({ statusCode: 400, error: 'validation_failed', message });
}
