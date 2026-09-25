// Mounts DoseActionForm for real (jsdom, client svelte) and drives its
// use:enhance callback by hand. The TEST FILE must mock `$app/forms` so that
// `enhance(form, submit)` hands `submit` over; this module only mounts and
// builds the arguments SvelteKit would pass.
import { vi } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import DoseActionForm from "$lib/components/dashboard/DoseActionForm.svelte";
import type { DoseWriteLock } from "$lib/components/dashboard/dose-write-lock.svelte";
import type { DashboardClock } from "$lib/components/dashboard/dashboard-clock";
import { dashboardContext } from "./dashboard-context";

export type DoseActionFormProps = ComponentProps<typeof DoseActionForm>;
export type SubmitCallback = Exclude<Awaited<ReturnType<SubmitFunction>>, void>;
type Update = Parameters<SubmitCallback>[0]["update"];

export const LOG_NOW_PROPS: DoseActionFormProps = {
  action: "?/logDose",
  fields: { medicationId: "m1", quantity: "1", forSlot: "2026-05-01T13:30:00.000Z" },
  label: "Log now",
  srContext: ": Metformin 500mg, 13:30 dose",
  pendingLabel: "Logging…",
  variant: "primary",
};

export function mountDoseActionForm(opts: {
  lock: DoseWriteLock;
  clock: DashboardClock;
  props?: Partial<DoseActionFormProps>;
  insideCard?: boolean;
}) {
  const list = document.createElement("ul");
  const host = document.createElement("li");
  if (opts.insideCard) host.setAttribute("data-dose-card", "");
  list.append(host);
  document.body.append(list);
  const component = mount(DoseActionForm, {
    target: host,
    props: { ...LOG_NOW_PROPS, ...opts.props },
    context: dashboardContext({ lock: opts.lock, clock: opts.clock }),
  });
  flushSync();
  const form = host.querySelector("form");
  const button = host.querySelector("button");
  if (!form || !button) throw new Error("DoseActionForm rendered no form or button");
  return {
    host,
    form,
    button,
    destroy() {
      unmount(component);
      list.remove();
    },
  };
}

/** What SvelteKit does when the form submits: call `submit` with the submit input. */
export async function startSubmit(submit: SubmitFunction, form: HTMLFormElement) {
  const cancel = vi.fn();
  const callback = await submit({
    action: new URL(form.action),
    formData: new FormData(form),
    formElement: form,
    controller: new AbortController(),
    submitter: form.querySelector("button"),
    cancel,
  });
  return { cancel, callback: (callback as SubmitCallback | undefined) ?? null };
}

/** What SvelteKit does when the response arrives: call the returned callback with the result. */
export function finishSubmit(
  callback: SubmitCallback,
  form: HTMLFormElement,
  result: ActionResult,
  update: Update = vi.fn(async () => {}),
) {
  const done = Promise.resolve(
    callback({
      action: new URL(form.action),
      formData: new FormData(form),
      formElement: form,
      result,
      update,
    }),
  );
  return { update, done };
}
