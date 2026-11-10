import { bookingAdmissionProtocolSchema } from '../../src/lib/booking-admission-release.ts';

export function assertBookingAdmissionRelease({ candidate, liveProtocol }) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('INVALID_CANDIDATE');
  }
  if (!Number.isInteger(candidate.reader) || candidate.reader < 1) {
    throw new Error('INVALID_CANDIDATE_READER');
  }
  if (candidate.release !== 'prepare' && candidate.release !== 'enforce') {
    throw new Error('INVALID_CANDIDATE_RELEASE');
  }
  if (typeof candidate.recoveryCompatible !== 'boolean') {
    throw new Error('INVALID_CANDIDATE_RECOVERY');
  }

  if (liveProtocol != null) {
    const parsed = bookingAdmissionProtocolSchema.safeParse(liveProtocol);
    if (!parsed.success) {
      throw new Error('LIVE_PROTOCOL_INVALID');
    }
    if (candidate.release === 'prepare') {
      throw new Error('ADMISSION_PREPARE_AFTER_ENFORCE');
    }
    if (candidate.reader < parsed.data.minimumReader) {
      throw new Error('INCOMPATIBLE_READER');
    }
    if (!candidate.recoveryCompatible) {
      throw new Error('INCOMPATIBLE_RECOVERY');
    }
    return;
  }

  if (candidate.release === 'enforce') {
    if (candidate.reader < 2) {
      throw new Error('INCOMPATIBLE_READER');
    }
    if (!candidate.recoveryCompatible) {
      throw new Error('INCOMPATIBLE_RECOVERY');
    }
  }
}
