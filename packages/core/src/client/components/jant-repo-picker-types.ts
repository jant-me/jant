/**
 * Types shared between the server-side template and the
 * `jant-repo-picker` Lit component.
 *
 * Labels arrive translated and already formatted. A `{name}` left in one is
 * deliberate: the value only exists in the browser, so the server keeps the
 * token literal (see `keepForClient` in the settings route) and the component
 * replaces it. Anything the server already knows is interpolated there.
 */

export interface RepoPickerLabels {
  pageTitle: string;
  pageSubtitle: string;
  ownerLabel: string;
  ownerPlaceholder: string;
  ownerEmpty: string;
  installAnother: string;
  repositoryLabel: string;
  repoPlaceholderNoOwner: string;
  repoPlaceholder: string;
  repoSearchPlaceholder: string;
  repoEmpty: string;
  repoLoading: string;
  repoShowingOf: string; // "Showing {shown} of {total}"
  repoSearchHint: string;
  refreshRepos: string; // aria-label + tooltip for the refresh button
  createOnGitHub: string; // primary call-to-action text
  createOnGitHubHint: string; // repo name already interpolated
  classifyLoading: string;
  classificationEmpty: string;
  classificationOwned: string;
  classificationOwnedByOther: string; // "{host}"
  classificationForeign: string;
  confirmHeading: string;
  confirmBody: string; // "{repo}"
  confirmInputLabel: string; // "{repo}"
  confirmInputPlaceholder: string;
  cancel: string;
  connect: string;
  connecting: string;
  privateBadge: string;
  connectionFailed: string;
  retry: string;
}
