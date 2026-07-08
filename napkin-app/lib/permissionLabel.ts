/**
 * permissionLabel — OS permission status → the settings-row pill (TICKET-142).
 *
 * The permissions section reads real OS state (expo-notifications /
 * expo-location) and shows a quiet On/Off pill. "On" means explicitly granted;
 * everything else (denied, undetermined, restricted, unknown, null) reads "Off"
 * — a not-yet-granted permission is functionally off from the user's seat.
 *
 * Pure + string-in / descriptor-out so the whole matrix is unit-testable
 * without a native module or a build.
 */

export type PermissionTone = 'positive' | 'muted';

export interface PermissionPill {
    label: 'On' | 'Off';
    tone: PermissionTone;
}

/** True only when the OS reports the permission explicitly granted. */
export function permissionOn(status: string | null | undefined): boolean {
    return status === 'granted';
}

/** The settings-row pill descriptor for an OS permission status. */
export function permissionPill(status: string | null | undefined): PermissionPill {
    return permissionOn(status)
        ? { label: 'On', tone: 'positive' }
        : { label: 'Off', tone: 'muted' };
}
