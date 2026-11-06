export interface Appointment {
  id: number;
  patientId: number;
  patientName: string;
  professionalId: number;
  professionalName: string;
  specialty: string;
  start: string;
  end: string;
  status: 'scheduled' | 'attended' | 'cancelled' | 'no_show';
}

export interface Attachment {
  id: number;
  encounterId: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface Encounter {
  id: number;
  appointmentId: number;
  version: number;
  replacesEncounterId: number | null;
  authorProfessionalId: number;
  notes: string;
  diagnosis: string;
  createdAt: string;
  attachments: Attachment[];
}

export interface AppointmentDetail extends Appointment {
  encounter: Encounter | null;
}

export interface Slot {
  start: string;
  end: string;
}

export interface Professional {
  id: number;
  name: string;
  surname: string;
  specialty: string;
}

export interface ClinicalHistory {
  patientId: number;
  patientName: string;
  encounters: Encounter[];
}

export interface Agenda {
  from: string;
  to: string;
  professionalId: number | null;
  days: Array<{ date: string; appointments: Appointment[] }>;
}

export interface SessionUser {
  id: number;
  email: string;
  roles: string[];
  patientId: number | null;
  professionalId: number | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_expires_in: number;
  user: SessionUser;
}

export interface AdminUser {
  id: number;
  email: string;
  roles: string[];
  active: boolean;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AuditEntry {
  id: number;
  usuario_id: number;
  accion: string;
  recurso_tipo: string;
  recurso_id: number | null;
  creado_en: string;
}
