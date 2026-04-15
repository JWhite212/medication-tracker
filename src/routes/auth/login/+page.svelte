<script lang="ts">
	import { enhance } from '$app/forms';

	let { form, data } = $props();
	let loading = $state(false);
</script>

<svelte:head>
	<title>Sign In — MedTracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
	<div
		class="w-full max-w-md rounded-xl border border-glass-border bg-glass p-8 backdrop-blur-xl"
	>
		<h1 class="mb-2 text-2xl font-bold">Welcome back</h1>
		<p class="mb-6 text-text-secondary">Sign in to your account</p>

		{#if form?.errors?.form}
			<div class="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">
				{form.errors.form[0]}
			</div>
		{/if}

		<form
			method="POST"
			use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					loading = false;
					await update();
				};
			}}
			class="space-y-4"
		>
			<div>
				<label for="email" class="mb-1 block text-sm font-medium">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					required
					value={form?.email ?? ''}
					class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
					placeholder="you@example.com"
				/>
			</div>
			<div>
				<label for="password" class="mb-1 block text-sm font-medium">Password</label>
				<input
					id="password"
					name="password"
					type="password"
					required
					class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
					placeholder="Your password"
				/>
			</div>
			<div class="flex items-center justify-between">
				<a href="/auth/reset-password" class="text-sm text-accent hover:underline"
					>Forgot password?</a
				>
			</div>
			<button
				type="submit"
				disabled={loading}
				class="w-full rounded-lg bg-accent py-2.5 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
			>
				{loading ? 'Signing in...' : 'Sign in'}
			</button>
		</form>

		{#if data.hasOAuth}
		<div class="mt-6 flex items-center gap-3">
			<div class="h-px flex-1 bg-glass-border"></div>
			<span class="text-xs text-text-muted">OR</span>
			<div class="h-px flex-1 bg-glass-border"></div>
		</div>
		<div class="mt-6 flex flex-col gap-3">
			<a
				href="/auth/callback/google"
				class="flex items-center justify-center gap-2 rounded-lg border border-glass-border py-2.5 text-sm font-medium transition-colors hover:bg-glass-hover"
				>Continue with Google</a
			>
			<a
				href="/auth/callback/github"
				class="flex items-center justify-center gap-2 rounded-lg border border-glass-border py-2.5 text-sm font-medium transition-colors hover:bg-glass-hover"
				>Continue with GitHub</a
			>
		</div>
		{/if}

		<p class="mt-6 text-center text-sm text-text-secondary">
			Don't have an account?
			<a href="/auth/register" class="text-accent hover:underline">Sign up</a>
		</p>
	</div>
</div>
