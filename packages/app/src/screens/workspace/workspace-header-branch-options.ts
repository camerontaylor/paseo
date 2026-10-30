import type { ComboboxOption } from "@/components/ui/combobox";

interface BranchSuggestionDetails {
  name: string;
  localRefs?: string[];
  remoteRefs?: string[];
}

export function baseBranchOptions(input: {
  branches: string[];
  branchDetails?: BranchSuggestionDetails[];
  currentBranchName: string;
}): ComboboxOption[] {
  const currentRef = `refs/heads/${input.currentBranchName}`;
  const details = input.branchDetails;
  if (!details?.some((detail) => detail.localRefs?.length || detail.remoteRefs?.length)) {
    // COMPAT(base-branch-suggestions): added in fork v0.10.1; remove when every supported daemon sends qualified refs.
    return input.branches
      .filter((name) => name !== input.currentBranchName)
      .map((name) => ({ id: name, label: name }));
  }

  return details.flatMap((detail) => {
    const options: ComboboxOption[] = [];
    for (const ref of detail.localRefs ?? []) {
      if (ref !== currentRef) {
        options.push({ id: ref, label: `${ref.slice("refs/heads/".length)} (local)` });
      }
    }
    for (const ref of detail.remoteRefs ?? []) {
      options.push({ id: ref, label: `${ref.slice("refs/remotes/origin/".length)} (origin)` });
    }
    return options;
  });
}
