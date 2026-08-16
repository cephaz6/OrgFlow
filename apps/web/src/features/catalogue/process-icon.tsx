import { FileText, KeyRound, Laptop, Receipt, UserPlus } from 'lucide-react';

export interface ProcessIconProps {
  name: string | null;
  className?: string;
}

// process_definitions.icon holds a name chosen by whoever authored the
// definition, so it is tenant data and cannot become a component reference
// dynamically. A switch returning elements rather than a lookup table
// returning components, because deriving a component value during render is
// what makes React remount the subtree, and the react-hooks rule rejects it.
//
// A name outside this list falls back rather than rendering nothing: a
// missing icon should not leave a hole in the row.
export function ProcessIcon({ name, className }: ProcessIconProps) {
  switch (name) {
    case 'laptop':
      return <Laptop aria-hidden="true" className={className} />;
    case 'access':
      return <KeyRound aria-hidden="true" className={className} />;
    case 'expense':
      return <Receipt aria-hidden="true" className={className} />;
    case 'onboarding':
      return <UserPlus aria-hidden="true" className={className} />;
    default:
      return <FileText aria-hidden="true" className={className} />;
  }
}
