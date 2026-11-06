import { describe, expect, it } from 'vitest';
import {
  AuthenticatedUser,
  canReadAppointmentDetail,
  canReadAttachment,
  canReadClinicalContent,
  canReadClinicalHistory,
  canRecordEncounter,
  canSearchAvailability,
  canViewAgenda,
} from '../src/common/authorization';

const patient1: AuthenticatedUser = {
  id: 1,
  email: 'paciente1@seed.local',
  roles: ['patient'],
  patientId: 1,
  professionalId: null,
};

const patient2: AuthenticatedUser = {
  id: 2,
  email: 'paciente2@seed.local',
  roles: ['patient'],
  patientId: 2,
  professionalId: null,
};

const gomez: AuthenticatedUser = {
  id: 4,
  email: 'gomez@seed.local',
  roles: ['professional'],
  patientId: null,
  professionalId: 1,
};

const lopez: AuthenticatedUser = {
  id: 5,
  email: 'lopez@seed.local',
  roles: ['professional'],
  patientId: null,
  professionalId: 2,
};

const staff: AuthenticatedUser = {
  id: 6,
  email: 'staff@seed.local',
  roles: ['staff'],
  patientId: null,
  professionalId: null,
};

const admin: AuthenticatedUser = {
  id: 7,
  email: 'admin@seed.local',
  roles: ['admin'],
  patientId: null,
  professionalId: null,
};

const appointment = { patientId: 1, professionalId: 1 };

describe('RF-10 data isolation', () => {
  it('lets a patient read only their own appointment scheduling data', () => {
    expect(canReadAppointmentDetail(patient1, appointment)).toBe(true);
    expect(canReadAppointmentDetail(patient2, appointment)).toBe(false);
  });

  it('lets the assigned professional read the appointment', () => {
    expect(canReadAppointmentDetail(gomez, appointment)).toBe(true);
    expect(canReadAppointmentDetail(lopez, appointment)).toBe(false);
  });

  it('lets staff read scheduling data but never clinical content', () => {
    expect(canReadAppointmentDetail(staff, appointment)).toBe(false);
    expect(canReadClinicalContent(staff, appointment)).toBe(false);
    expect(canViewAgenda(staff)).toBe(true);
    expect(canSearchAvailability(staff)).toBe(true);
  });

  it('never gives admins access to clinical content', () => {
    expect(canReadClinicalContent(admin, appointment)).toBe(false);
    expect(canReadAppointmentDetail(admin, appointment)).toBe(false);
  });

  it('grants clinical content to the owning patient and assigned professional', () => {
    expect(canReadClinicalContent(patient1, appointment)).toBe(true);
    expect(canReadClinicalContent(patient2, appointment)).toBe(false);
    expect(canReadClinicalContent(gomez, appointment)).toBe(true);
    expect(canReadClinicalContent(lopez, appointment)).toBe(false);
  });

  it('only the assigned professional records encounters', () => {
    expect(canRecordEncounter(gomez, appointment)).toBe(true);
    expect(canRecordEncounter(lopez, appointment)).toBe(false);
    expect(canRecordEncounter(patient1, appointment)).toBe(false);
    expect(canRecordEncounter(staff, appointment)).toBe(false);
    expect(canRecordEncounter(admin, appointment)).toBe(false);
  });

  it('restricts clinical history to self or an assigned professional', () => {
    expect(canReadClinicalHistory(patient1, 1, false)).toBe(true);
    expect(canReadClinicalHistory(patient2, 1, false)).toBe(false);
    expect(canReadClinicalHistory(gomez, 1, true)).toBe(true);
    expect(canReadClinicalHistory(gomez, 1, false)).toBe(false);
    expect(canReadClinicalHistory(lopez, 1, true)).toBe(true);
    expect(canReadClinicalHistory(staff, 1, true)).toBe(false);
    expect(canReadClinicalHistory(admin, 1, true)).toBe(false);
  });

  it('lets only the author professional and owning patient download attachments', () => {
    const attachment = { patientId: 1, authorProfessionalId: 1 };
    expect(canReadAttachment(patient1, attachment)).toBe(true);
    expect(canReadAttachment(patient2, attachment)).toBe(false);
    expect(canReadAttachment(gomez, attachment)).toBe(true);
    expect(canReadAttachment(lopez, attachment)).toBe(false);
    expect(canReadAttachment(staff, attachment)).toBe(false);
    expect(canReadAttachment(admin, attachment)).toBe(false);
  });
});
