/**
 * Texts of the public legal pages (/legal/<slug>) and of the DPA record PDF. One source for both, so the PDF an
 * owner downloads says exactly what the page said when they accepted it. Plain data, no React: node --test and the
 * PDF renderer read it too.
 *
 * Changing the DPA means a new DPA_VERSION (a date); owners then see that the accepted version is older.
 */
import type { Provider } from './provider.ts';

export const DPA_VERSION = '2026-09-25';

export type Block = { p: string } | { ul: string[] } | { table: { head: string[]; rows: string[][] } };

export interface LegalSection {
  heading: string;
  blocks: Block[];
}

export interface LegalDocument {
  slug: LegalSlug;
  title: string;
  /** Date of the text; for the DPA also the version owners accept. */
  version: string;
  summary: string;
  sections: LegalSection[];
}

export const LEGAL_SLUGS = ['terms', 'privacy', 'dpa', 'subprocessors', 'retention'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export function isLegalSlug(value: string): value is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(value);
}

/** Runs are kept this many days on each plan; the migrations hold the same numbers (plans.retention_days). */
export const PLAN_HISTORY_DAYS = { Free: 14, Team: 90, Agency: 365 } as const;
export const GRACE_DAYS = 30;
export const INVITATION_DAYS = 30;

export interface Subprocessor {
  name: string;
  purpose: string;
  data: string;
  location: string;
}

/**
 * Companies that process customer data for the hosted service. Hosting and email are not chosen yet (founder
 * decisions in ADR 0008 and 0015); the entries name the current candidates and must match the production setup
 * before the draft banner goes.
 */
export const SUBPROCESSORS: Subprocessor[] = [
  { name: 'Supabase Inc.', purpose: 'Database and sign-in', data: 'Everything the service stores', location: 'EU (Frankfurt, AWS eu-central-1)' },
  { name: 'Vercel Inc.', purpose: 'Hosting of the web application', data: 'Requests to the application, including uploaded reports in transit; request logs', location: 'EU (Frankfurt) for functions; global edge network' },
  { name: 'Resend Inc.', purpose: 'Email delivery (sign-in codes, run notifications)', data: 'Email addresses; workflow and workspace names and run status in notifications', location: 'EU (Ireland, AWS eu-west-1)' },
  { name: 'Stripe Payments Europe Ltd.', purpose: 'Payments and invoices', data: 'Billing contact, address, VAT number, payment method', location: 'EU (Ireland), with transfers to Stripe Inc. under the EU Standard Contractual Clauses' },
];

export interface RetentionRow {
  what: string;
  kept: string;
  removed: string;
}

export const RETENTION_ROWS: RetentionRow[] = [
  {
    what: 'Uploaded runs: redacted report, status, runner and engine, git repository, commit and pull request number',
    kept: `The plan's history (Free ${PLAN_HISTORY_DAYS.Free} days, Team ${PLAN_HISTORY_DAYS.Team}, Agency ${PLAN_HISTORY_DAYS.Agency}) or a shorter period an owner sets`,
    removed: 'Every night at 03:17 UTC; at any time by an owner (run, workspace or organization)',
  },
  {
    what: 'GitHub check records and the log of notifications sent for a run (recipient address, channel, result)',
    kept: 'As long as the run',
    removed: 'With the run',
  },
  {
    what: 'Acceptances: who accepted which cases, when, and their message',
    kept: 'As long as the workspace; they are the approval history',
    removed: 'With the workspace or organization',
  },
  {
    what: 'Workspaces, workflow names and ids, workspace tokens (only a SHA-256 hash of each), linked GitHub installations, Slack webhook addresses, notification settings',
    kept: 'Until an owner deletes them',
    removed: 'By an owner; with the organization',
  },
  {
    what: 'Members: email address and role',
    kept: 'While the person belongs to the organization',
    removed: 'When an owner removes them or they delete their account',
  },
  {
    what: 'Invitations: invited email address',
    kept: `Until accepted or cancelled, at most ${INVITATION_DAYS} days`,
    removed: 'On acceptance or cancellation; every night after 30 days',
  },
  {
    what: 'Account: email address, sign-in times',
    kept: 'Until the account is deleted',
    removed: 'On the Account page',
  },
  {
    what: 'Sign-in attempts (email address, IP address), used to limit guessing of codes',
    kept: '1 day',
    removed: 'Every night',
  },
  {
    what: 'Upload counter per organization (time of each upload)',
    kept: '2 days',
    removed: 'Every night',
  },
  {
    what: 'DPA acceptances: company, signer name, role and email, version, time',
    kept: 'As long as the organization',
    removed: 'With the organization',
  },
  {
    what: 'Plan and subscription state, copies of invoices',
    kept: 'As long as the organization; Stripe keeps invoices for as long as tax law requires',
    removed: 'With the organization (the copies); Stripe under its own policy',
  },
  {
    what: 'Stripe webhook events (ids and types, used to process each event once)',
    kept: '90 days',
    removed: 'Every night',
  },
  {
    what: 'Database backups made by the hosting provider',
    kept: '7 days',
    removed: 'Overwritten by newer backups',
  },
];

const LOCAL_ONLY =
  'The runner never uploads request bodies, recorded executions, fixtures, baselines or credentials. They stay in the .flowretest folder on the machine or CI runner where the runner ran.';

const REDACTED =
  'A redacted report holds workflow and node names, version labels, HTTP methods, hosts, URL templates, field names, and each value as its type, its length and a hash. The hash is keyed with a random secret that is created for each report on the runner and never uploaded, so the service cannot recompute it from a guessed value. Error messages come with email addresses, quoted text and long numbers replaced. The service refuses a report that still carries values.';

function dpa(p: Provider): LegalDocument {
  return {
    slug: 'dpa',
    title: 'Data Processing Agreement',
    version: DPA_VERSION,
    summary: 'Terms under which FlowRetest processes personal data for an organization, as required by Article 28 of the GDPR.',
    sections: [
      {
        heading: '1. Parties and scope',
        blocks: [
          { p: `This agreement is between the organization that accepts it (the Customer) and ${p.name}, ${p.address}, ${p.companyId} (the Provider). It applies to personal data the Provider processes for the Customer when it provides the FlowRetest hosted service under the Terms of Service.` },
          { p: 'The Customer acts as a controller, or as a processor for its own clients. When the Customer is a processor, the Provider is its sub-processor and the Customer passes on the obligations of its own agreement that concern the service.' },
          { p: 'The open source runner (the flowretest CLI and GitHub Action) runs on the Customer\'s machines and is not part of the processing covered here. The Provider has no access to the data the runner reads or keeps.' },
        ],
      },
      {
        heading: '2. Subject, nature and purpose',
        blocks: [
          { p: 'The Provider stores redacted run reports the Customer uploads, shows them to the Customer\'s members, records acceptances, sends the notifications the Customer configures (email, Slack, GitHub checks), and keeps the members and settings of the organization.' },
          { p: 'The Provider processes the data only to provide the service and for no purpose of its own. It does not sell the data, does not use it to train models and does not combine it with data of other customers.' },
        ],
      },
      {
        heading: '3. Data and data subjects',
        blocks: [
          {
            ul: [
              'Members and invited people of the Customer: email address, role, sign-in times, IP address of sign-in attempts, messages they write when accepting a run.',
              'Clients of the Customer and their contacts, only in redacted form: types, lengths and keyed hashes of values that n8n workflows would send, plus names the Customer gave to workflows, nodes and workspaces.',
              'Authors of commits, only as a repository name, commit hash and pull request number when the runner uploads from CI.',
            ],
          },
          { p: REDACTED },
          { p: `${LOCAL_ONLY} The Customer must not put personal data into workflow, node or workspace names it uploads, and must upload only reports written by flowretest upload or flowretest redact --report.` },
        ],
      },
      {
        heading: '4. Instructions',
        blocks: [
          { p: 'The Customer\'s instructions are this agreement, the Terms of Service, and the settings its owners choose in the application (members, workspaces, integrations, retention). The Provider tells the Customer without delay if it believes an instruction breaks data protection law.' },
        ],
      },
      {
        heading: '5. Confidentiality and security',
        blocks: [
          { p: 'People at the Provider with access to customer data are bound by confidentiality. Access is limited to the people who operate the service. The technical and organizational measures are listed in Annex 2; the Provider may replace a measure with one that protects the data at least as well.' },
        ],
      },
      {
        heading: '6. Sub-processors',
        blocks: [
          { p: 'The Customer allows the Provider to use the sub-processors listed at /legal/subprocessors (Annex 3). The Provider binds each of them by a written contract with data protection obligations no weaker than these.' },
          { p: 'The Provider announces a new or replaced sub-processor on that page and by email to the owners of the organization at least 30 days before it starts processing. The Customer may object in writing within those 30 days; if the parties find no solution, the Customer may terminate the affected paid plan and receives a refund of prepaid fees for the unused period.' },
          { p: 'GitHub and Slack receive data only when an owner links a GitHub installation or adds a Slack webhook. They act on the Customer\'s instructions under the Customer\'s own agreements with them and are not sub-processors of the Provider.' },
        ],
      },
      {
        heading: '7. Transfers outside the EEA',
        blocks: [
          { p: 'The Provider stores customer data in the European Union. A transfer outside the European Economic Area happens only to a sub-processor listed in Annex 3 and under an adequacy decision or the EU Standard Contractual Clauses.' },
        ],
      },
      {
        heading: '8. Assistance',
        blocks: [
          { p: 'The Provider helps the Customer answer requests of data subjects. The application lets owners export the organization\'s data and delete runs, workspaces and the organization, and lets each member delete their account; for anything else the Customer writes to ' + p.email + '. The Provider also gives the information the Customer needs for a data protection impact assessment or a consultation with a supervisory authority.' },
        ],
      },
      {
        heading: '9. Personal data breaches',
        blocks: [
          { p: 'The Provider notifies the owners of the organization without undue delay and no later than 48 hours after it becomes aware of a breach affecting the Customer\'s data. The notice says what happened, which data and how many people are affected as far as known, the likely consequences, and the measures taken. The Provider sends further details as it learns them.' },
        ],
      },
      {
        heading: '10. Deletion and return',
        blocks: [
          { p: 'Runs are deleted after the retention period of the plan or the shorter period an owner sets, as described at /legal/retention. An owner can export all data of the organization at any time (Data page of the organization).' },
          { p: 'When the Customer deletes the organization, its data is removed from the live database at once and from backups within 7 days, unless law requires the Provider to keep a copy. Invoices are kept for as long as tax law requires.' },
        ],
      },
      {
        heading: '11. Audits',
        blocks: [
          { p: 'The Provider makes available the information needed to show compliance with this agreement. The Customer, or an auditor bound by confidentiality, may audit once a year with 30 days\' notice, during business hours and at the Customer\'s cost, and more often after a breach. The Provider may answer first with documents and a written questionnaire.' },
        ],
      },
      {
        heading: '12. Term, liability and precedence',
        blocks: [
          { p: 'This agreement lasts as long as the Provider processes data for the Customer. Liability follows the Terms of Service. If this agreement and the Terms of Service disagree about personal data, this agreement prevails. Polish law applies.' },
        ],
      },
      {
        heading: 'Annex 1. Details of processing',
        blocks: [
          {
            table: {
              head: ['Item', 'Description'],
              rows: [
                ['Subject', 'Hosting of redacted FlowRetest run reports and the approval history for the Customer'],
                ['Duration', 'The term of the Terms of Service plus the deletion periods in section 10'],
                ['Data subjects', 'Members and invited people of the Customer; clients of the Customer and their contacts in redacted form; commit authors as repository and commit ids'],
                ['Data', 'Email addresses, roles, sign-in times and IP addresses of sign-in attempts, acceptance messages; types, lengths and keyed hashes of values; names given by the Customer'],
                ['Special categories', 'None intended; values are never uploaded in clear text'],
                ['Operations', 'Storage, display, comparison of runs, notifications, export, deletion'],
                ['Retention', 'As listed at /legal/retention'],
              ],
            },
          },
        ],
      },
      {
        heading: 'Annex 2. Technical and organizational measures',
        blocks: [
          {
            ul: [
              'Redaction on the Customer\'s side before upload, with a keyed hash whose key stays on the runner; the service refuses reports with values in them.',
              'TLS for every connection to the application and between the application and its database.',
              'Encryption at rest of the database and its backups by the hosting provider (AES-256).',
              'Row level security in the database: members read only their own organizations; only the server writes runs, after checking the report.',
              'Workspace tokens stored as SHA-256 hashes only; revocation takes effect on the next request.',
              'Sign-in by one-time codes and links sent by email, no passwords; limits on codes per address and per IP address.',
              'Content Security Policy with a nonce per request; no third-party scripts or trackers in the application.',
              'Addresses of Slack webhooks restricted to hooks.slack.com; GitHub checks only for repositories of the linked installation.',
              'Daily backups kept for 7 days; nightly deletion of expired data.',
              'Access to production limited to the people who operate the service, with two-factor authentication on the hosting, database and payment accounts.',
            ],
          },
        ],
      },
      {
        heading: 'Annex 3. Sub-processors',
        blocks: [{ table: { head: ['Company', 'Purpose', 'Data', 'Location'], rows: SUBPROCESSORS.map((s) => [s.name, s.purpose, s.data, s.location]) } }],
      },
    ],
  };
}

function subprocessors(): LegalDocument {
  return {
    slug: 'subprocessors',
    title: 'Sub-processors',
    version: DPA_VERSION,
    summary: 'Companies that process data for the FlowRetest hosted service.',
    sections: [
      {
        heading: 'Current list',
        blocks: [{ table: { head: ['Company', 'Purpose', 'Data', 'Location'], rows: SUBPROCESSORS.map((s) => [s.name, s.purpose, s.data, s.location]) } }],
      },
      {
        heading: 'Changes',
        blocks: [
          { p: 'A new or replaced sub-processor is announced here and by email to the owners of every organization that accepted the Data Processing Agreement, at least 30 days before it starts processing (section 6 of the DPA).' },
          { p: 'GitHub and Slack are not on this list. They receive data only when an owner links them, and act under the organization\'s own agreements with them.' },
        ],
      },
    ],
  };
}

function retention(): LegalDocument {
  return {
    slug: 'retention',
    title: 'Data retention',
    version: DPA_VERSION,
    summary: 'What the hosted service stores, for how long, and how it is deleted.',
    sections: [
      {
        heading: 'What never reaches the service',
        blocks: [{ p: LOCAL_ONLY }, { p: REDACTED }],
      },
      {
        heading: 'What the service stores and for how long',
        blocks: [{ table: { head: ['Data', 'Kept', 'Deleted'], rows: RETENTION_ROWS.map((r) => [r.what, r.kept, r.removed]) } }],
      },
      {
        heading: 'Shorter history',
        blocks: [
          { p: 'An owner can set a shorter run history for the organization on its Data page, for example when a client contract allows 30 days. The nightly deletion then uses the shorter of the plan\'s period and the owner\'s.' },
        ],
      },
      {
        heading: 'After a plan change',
        blocks: [
          { p: `For ${GRACE_DAYS} days after a paid plan ends or changes to a smaller one, runs are kept as long as the previous plan kept them, so a failed card or a downgrade does not delete a year of history in one night. The shorter period set by an owner still applies during that time.` },
        ],
      },
      {
        heading: 'Export and deletion',
        blocks: [
          {
            ul: [
              'Owners export all data of the organization as one JSON Lines file from its Data page, on every plan.',
              'Owners delete single runs, workspaces with all their runs and acceptances, or the whole organization. Deleting an organization with a running subscription is refused until the subscription is cancelled.',
              'Each person deletes their own account on the Account page. An owner who is the only owner of an organization with other members has to make someone else an owner first.',
              'Deleted data leaves the backups within 7 days.',
            ],
          },
        ],
      },
    ],
  };
}

function privacy(p: Provider): LegalDocument {
  return {
    slug: 'privacy',
    title: 'Privacy notice',
    version: DPA_VERSION,
    summary: 'How FlowRetest handles the personal data of people who use the hosted service or visit its pages.',
    sections: [
      {
        heading: 'Who is responsible',
        blocks: [
          { p: `${p.name}, ${p.address}, ${p.companyId}, is the controller of the data described here. Contact: ${p.email}.` },
          { p: 'For data inside an organization (runs, acceptances, members) the organization is the controller and FlowRetest its processor under the Data Processing Agreement. Questions about that data go to the organization first.' },
        ],
      },
      {
        heading: 'What we process and why',
        blocks: [
          {
            table: {
              head: ['Data', 'Purpose', 'Legal basis (GDPR)'],
              rows: [
                ['Email address, sign-in times', 'Your account and sign-in by email code', 'Contract, Art. 6(1)(b)'],
                ['Email address and IP address of sign-in attempts', 'Limiting guessing of sign-in codes', 'Legitimate interest in securing accounts, Art. 6(1)(f)'],
                ['Billing contact, address, VAT number', 'Payments and invoices', 'Contract and tax law, Art. 6(1)(b) and (c)'],
                ['Request logs of the hosting provider (IP address, path, time)', 'Running and securing the service', 'Legitimate interest, Art. 6(1)(f)'],
                ['Emails you send us', 'Answering you', 'Legitimate interest, Art. 6(1)(f)'],
              ],
            },
          },
        ],
      },
      {
        heading: 'Cookies',
        blocks: [{ p: 'The application sets only the cookies that keep you signed in. The public pages set none. There is no analytics, advertising or third-party tracking.' }],
      },
      {
        heading: 'Recipients',
        blocks: [{ p: 'The sub-processors at /legal/subprocessors process data for us. We give data to authorities only when the law requires it.' }],
      },
      {
        heading: 'How long',
        blocks: [{ p: 'As listed at /legal/retention. Invoices and the records tax law requires are kept for 5 years from the end of the year they concern.' }],
      },
      {
        heading: 'Your rights',
        blocks: [
          { p: `You can ask for access to your data, a copy of it, its correction or deletion, a restriction of processing, and you can object to processing based on legitimate interest. Write to ${p.email}; we answer within one month. You can delete your account yourself on the Account page.` },
          { p: 'You can complain to the President of the Personal Data Protection Office (Prezes Urzędu Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warsaw, Poland) or to the authority where you live or work.' },
        ],
      },
    ],
  };
}

function terms(p: Provider): LegalDocument {
  return {
    slug: 'terms',
    title: 'Terms of Service',
    version: DPA_VERSION,
    summary: 'Terms for organizations using the FlowRetest hosted service.',
    sections: [
      {
        heading: '1. The service',
        blocks: [
          { p: `${p.name}, ${p.address}, ${p.companyId} (we) provides the FlowRetest hosted service: storage and display of redacted run reports, acceptances, GitHub checks and notifications for organizations (you). The service is for businesses, not consumers.` },
          { p: 'The flowretest runner and GitHub Action are open source under the MIT License and can be used without an account. These terms cover only the hosted service.' },
        ],
      },
      {
        heading: '2. Accounts and organizations',
        blocks: [
          { p: 'People sign in with their email address. Owners of an organization decide who belongs to it and are responsible for what its members and tokens do. Keep workspace tokens secret and revoke a token you think has leaked.' },
        ],
      },
      {
        heading: '3. Plans and payment',
        blocks: [
          { p: 'The plans, their limits and prices are on the pricing page. Prices exclude VAT. Paid plans are billed in advance, monthly or yearly, by Stripe. A plan change takes effect at once and is charged or credited pro rata.' },
          { p: 'You can cancel at any time on the billing page. The plan stays until the end of the paid period; we do not refund the remaining part of a period, except as stated in section 6 of the Data Processing Agreement.' },
          { p: 'If a payment fails and Stripe cannot collect it after its retries, the organization moves to the Free plan. Nothing is deleted on that day; the retention rules at /legal/retention apply.' },
        ],
      },
      {
        heading: '4. Your data',
        blocks: [
          { p: 'You keep all rights to the data you upload. You give us the right to store and process it only to provide the service. The Data Processing Agreement at /legal/dpa is part of these terms and applies to personal data in the service.' },
          { p: 'Upload only reports written by flowretest upload or flowretest redact --report. Do not put personal data or secrets into workflow, node or workspace names.' },
        ],
      },
      {
        heading: '5. Acceptable use',
        blocks: [
          { p: 'Do not use the service to break the law, to attack it or other systems, to get around its limits, or to store data it was not built for. We may suspend an organization that does, after a notice where the situation allows one.' },
        ],
      },
      {
        heading: '6. Availability and changes',
        blocks: [
          { p: 'We run the service with care but do not promise uninterrupted availability. The runner works without the service; a failed upload does not change the result of a run. We announce changes that remove a paid feature at least 30 days in advance.' },
        ],
      },
      {
        heading: '7. Liability',
        blocks: [
          { p: 'FlowRetest shows which HTTP calls a workflow change would alter. It does not guarantee that a change without differences is correct, and the decision to deploy stays with you. Our total liability for any claim is limited to the fees you paid in the 12 months before it arose. Neither party is liable for lost profits or indirect damage. These limits do not apply to damage caused intentionally or where the law does not allow a limit.' },
        ],
      },
      {
        heading: '8. Changes to these terms, law and courts',
        blocks: [
          { p: 'We send changes to these terms to the owners by email at least 30 days before they take effect; if you do not accept them you can cancel before that date. Polish law applies. Disputes go to the court competent for our registered office.' },
        ],
      },
    ],
  };
}

/**
 * Every DPA version an owner has accepted, by version. A new version gets a new function here and the old one
 * stays, so the PDF copy of an old acceptance still prints the text that was accepted.
 */
const DPA_TEXTS: Record<string, (p: Provider) => LegalDocument> = { [DPA_VERSION]: dpa };

export function dpaDocument(version: string, p: Provider): LegalDocument | undefined {
  return DPA_TEXTS[version]?.(p);
}

/** Owners may accept only a reviewed text, except where LEGAL_ALLOW_DRAFT_ACCEPTANCE is set (local stack, CI). */
export function dpaAcceptanceOpen(p: Provider, source: Record<string, string | undefined> = process.env): boolean {
  return !p.draft || source.LEGAL_ALLOW_DRAFT_ACCEPTANCE === 'true';
}

export function legalDocument(slug: LegalSlug, p: Provider): LegalDocument {
  switch (slug) {
    case 'dpa':
      return dpa(p);
    case 'subprocessors':
      return subprocessors();
    case 'retention':
      return retention();
    case 'privacy':
      return privacy(p);
    case 'terms':
      return terms(p);
  }
}
