import { Button, Card, EmptyState } from '@orgflow/ui';
import { LibraryBig } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { fetchMyQueue } from '../../features/approvals';
import { fetchMyCases } from '../../features/cases';
import { fetchCatalogue } from '../../features/catalogue';
import {
  QuickStart,
  selectOpenRequests,
  WaitingOnYou,
  YourRequests,
} from '../../features/dashboard';
import { PageHeader } from '../../features/shell';

export const metadata: Metadata = {
  title: 'Dashboard: OrgFlow',
};

export default async function DashboardPage() {
  // In parallel: none of the three depends on another, and the page cannot
  // render until all have arrived, so sequencing them would only add their
  // latencies together.
  const [approvals, cases, cataloguePage] = await Promise.all([
    fetchMyQueue(),
    fetchMyCases(),
    // A large, unpaginated limit rather than the catalogue page's own
    // default: this widget only ever builds an id-to-name lookup and a
    // "is there anything at all" check, not a browsable list, so it wants
    // effectively everything rather than a first page an organisation with
    // more processes than that would silently truncate.
    fetchCatalogue({ limit: 200 }),
  ]);
  const catalogue = cataloguePage.data;

  // One instant for the whole page, so two rows cannot disagree about
  // whether the same deadline has passed.
  const now = new Date();

  const openRequests = selectOpenRequests(cases);
  const processNames = Object.fromEntries(
    catalogue.map((entry) => [entry.definitionId, entry.name]),
  );

  // Nothing assigned, nothing submitted. Not the same as "no processes
  // exist": if the catalogue is empty too, the honest thing to say is that
  // the organisation has nothing published, because browsing it would be a
  // dead end.
  const isNewHere = approvals.length === 0 && openRequests.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Dashboard"
        description="Approvals waiting on you and the requests you have open."
        actions={
          catalogue.length > 0 ? (
            <Button asChild>
              <Link href="/catalogue">Start a request</Link>
            </Button>
          ) : undefined
        }
      />

      {isNewHere ? (
        <EmptyState
          icon={LibraryBig}
          title={
            catalogue.length > 0
              ? 'Nothing is waiting on you'
              : 'Your organisation has no published processes yet'
          }
          description={
            catalogue.length > 0
              ? 'Approvals assigned to you and requests you submit will appear here. Browse the catalogue to start one.'
              : 'A process owner needs to build and publish a process before anyone can start a request.'
          }
          {...(catalogue.length > 0
            ? {
                action: (
                  <Button asChild variant="outline">
                    <Link href="/catalogue">Browse the catalogue</Link>
                  </Button>
                ),
              }
            : {})}
        />
      ) : null}

      {approvals.length > 0 ? (
        <section aria-labelledby="waiting-heading" className="flex flex-col gap-4">
          <h2 id="waiting-heading" className="text-lg font-semibold">
            Waiting on you
            {/* The count is a plain number beside the heading rather than a
                coloured pill: it is a quantity, not a status, and colouring
                it would imply a severity the number does not carry. */}
            <span className="ms-2 font-normal text-muted-foreground">{approvals.length}</span>
          </h2>
          <Card>
            <WaitingOnYou entries={approvals} now={now} />
          </Card>
        </section>
      ) : null}

      {openRequests.length > 0 ? (
        <section aria-labelledby="requests-heading" className="flex flex-col gap-4">
          <h2 id="requests-heading" className="text-lg font-semibold">
            Your open requests
            <span className="ms-2 font-normal text-muted-foreground">{openRequests.length}</span>
          </h2>
          <Card>
            <YourRequests cases={cases} processNames={processNames} />
          </Card>
        </section>
      ) : null}

      {/* Hidden when there is nothing to start, and when the empty state
          above is already pointing at the catalogue, so the page never
          offers the same next step twice. */}
      {catalogue.length > 0 && !isNewHere ? (
        <section aria-labelledby="start-heading" className="flex flex-col gap-4">
          <h2 id="start-heading" className="text-lg font-semibold">
            Start something
          </h2>
          <QuickStart entries={catalogue} />
        </section>
      ) : null}
    </div>
  );
}
