import type { BreadcrumbItem } from '@orgflow/ui';

// Every trail in the app starts here, so it is a shared constant rather
// than a string literal repeated at every call site.
export const HOME_CRUMB: BreadcrumbItem = { label: 'Dashboard', href: '/' };
