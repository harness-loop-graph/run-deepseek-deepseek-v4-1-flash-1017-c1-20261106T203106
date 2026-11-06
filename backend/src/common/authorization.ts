export const ROLES = ['patient', 'professional', 'staff', 'admin'] as const;

export type Role = (typeof ROLES)[number];

export interface AuthenticatedUser {
  id: number;
  email: string;
  roles: Role[];
  patientId: number | null;
  professionalId: number | null;
}

export interface AppointmentOwnership {
  patientId: number;
  professionalId: number;
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function hasAnyRole(
  user: Pick<AuthenticatedUser, 'roles'>,
  roles: readonly Role[],
): boolean {
  return user.roles.some((role) => roles.includes(role));
}

/**
 * EP-10 is specified for "patient (own) or assigned professional": the payload
 * carries the clinical summary, so staff and admin never reach it (staff reads
 * scheduling data through EP-09). RF-10 is enforced here and in the query.
 */
export function canReadAppointmentDetail(
  user: AuthenticatedUser,
  appointment: AppointmentOwnership,
): boolean {
  if (hasAnyRole(user, ['patient']) && user.patientId === appointment.patientId) {
    return true;
  }
  return (
    hasAnyRole(user, ['professional']) &&
    user.professionalId !== null &&
    user.professionalId === appointment.professionalId
  );
}

/**
 * Clinical content (encounter notes, diagnosis, attachments) is readable by
 * the owning patient and the assigned professional only. Staff and admin are
 * always denied (RF-10).
 */
export function canReadClinicalContent(
  user: AuthenticatedUser,
  appointment: AppointmentOwnership,
): boolean {
  return canReadAppointmentDetail(user, appointment);
}

export function canRecordEncounter(
  user: AuthenticatedUser,
  appointment: AppointmentOwnership,
): boolean {
  return (
    hasAnyRole(user, ['professional']) &&
    user.professionalId !== null &&
    user.professionalId === appointment.professionalId
  );
}

/**
 * A patient reads only their own history; a professional reads the history of
 * patients with an assigned appointment (past or future).
 */
export function canReadClinicalHistory(
  user: AuthenticatedUser,
  patientId: number,
  hasAssignedAppointment: boolean,
): boolean {
  if (hasAnyRole(user, ['patient']) && user.patientId === patientId) {
    return true;
  }
  return hasAnyRole(user, ['professional']) && hasAssignedAppointment;
}

export function canReadAttachment(
  user: AuthenticatedUser,
  attachment: { patientId: number; authorProfessionalId: number },
): boolean {
  if (hasAnyRole(user, ['patient']) && user.patientId === attachment.patientId) {
    return true;
  }
  return (
    hasAnyRole(user, ['professional']) &&
    user.professionalId !== null &&
    user.professionalId === attachment.authorProfessionalId
  );
}

export function canSearchAvailability(user: AuthenticatedUser): boolean {
  return hasAnyRole(user, ['patient', 'staff']);
}

export function canViewAgenda(user: AuthenticatedUser): boolean {
  return hasAnyRole(user, ['professional', 'staff']);
}
