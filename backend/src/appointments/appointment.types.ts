export interface AppointmentRow {
  id: number;
  paciente_id: number;
  profesional_id: number;
  franja_inicio: Date;
  franja_fin: Date;
  estado: 'scheduled' | 'attended' | 'cancelled' | 'no_show';
  paciente_nombre: string;
  paciente_apellido: string;
  profesional_nombre: string;
  profesional_apellido: string;
  profesional_especialidad: string;
}

export interface AppointmentDto {
  id: number;
  patientId: number;
  patientName: string;
  professionalId: number;
  professionalName: string;
  specialty: string;
  start: string;
  end: string;
  status: string;
}

export interface EncounterDto {
  id: number;
  appointmentId: number;
  version: number;
  replacesEncounterId: number | null;
  authorProfessionalId: number;
  notes: string;
  diagnosis: string;
  createdAt: string;
  attachments: AttachmentDto[];
}

export interface AttachmentDto {
  id: number;
  encounterId: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export function toAppointmentDto(row: AppointmentRow): AppointmentDto {
  return {
    id: row.id,
    patientId: row.paciente_id,
    patientName: `${row.paciente_nombre} ${row.paciente_apellido}`,
    professionalId: row.profesional_id,
    professionalName: `${row.profesional_nombre} ${row.profesional_apellido}`,
    specialty: row.profesional_especialidad,
    start: row.franja_inicio.toISOString(),
    end: row.franja_fin.toISOString(),
    status: row.estado,
  };
}
