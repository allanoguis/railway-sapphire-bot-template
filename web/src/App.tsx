import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { request, type Session } from './api';

type View = 'account' | 'profile' | 'info' | 'members' | 'unregistered' | 'organized-crime';
type RecordData = Record<string, unknown>;
const labels: Record<View, string> = {
	account: 'Account',
	profile: 'Player profile',
	info: 'Faction info',
	members: 'Members',
	unregistered: 'Unregistered',
	'organized-crime': 'Organized crime'
};
const obj = (value: unknown): RecordData => (value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordData) : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => {
	if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString();
	if (typeof value === 'string' && value.trim()) return value;
	return 'Unavailable';
};
const date = (value: unknown): string => {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'Unavailable';
	const parsed = new Date(value * 1000);
	return Number.isNaN(parsed.getTime()) ? 'Unavailable' : parsed.toLocaleString();
};
const status = (value: unknown): string => {
	const item = obj(value);
	return (
		[...new Set([item.description, item.details, item.state].filter((v): v is string => typeof v === 'string' && !!v.trim()))].join(' · ') ||
		'Unavailable'
	);
};
const lastAction = (value: unknown): string => {
	const item = obj(value);
	return item.relative ? text(item.relative) : item.timestamp ? date(item.timestamp) : text(item.status);
};

function useResource() {
	const [data, setData] = useState<unknown>(null);
	const [loaded, setLoaded] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [loadedAt, setLoadedAt] = useState<Date | null>(null);
	const controller = useRef<AbortController | null>(null);
	const reset = useCallback(() => {
		controller.current?.abort();
		controller.current = null;
		setData(null);
		setLoaded(false);
		setLoading(false);
		setError('');
		setLoadedAt(null);
	}, []);
	useEffect(
		() => () => {
			controller.current?.abort();
		},
		[]
	);
	const load = async (path: string) => {
		controller.current?.abort();
		const current = new AbortController();
		controller.current = current;
		setData(null);
		setLoaded(false);
		setError('');
		setLoading(true);
		try {
			const result = await request<unknown>(path, { signal: current.signal });
			if (!current.signal.aborted) {
				setData(result);
				setLoadedAt(new Date());
				setLoaded(true);
			}
		} catch (e) {
			if (!current.signal.aborted) setError(e instanceof Error ? e.message : 'Something went wrong.');
		} finally {
			if (controller.current === current) {
				controller.current = null;
				setLoading(false);
			}
		}
	};
	return {
		data,
		loaded,
		loadedAt,
		loading,
		error,
		load,
		reset,
		cancel: () => {
			reset();
			setError('Request cancelled.');
		}
	};
}

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
	return (
		<div className={error ? 'notice error' : 'notice'} role={error ? 'alert' : 'status'}>
			{children}
		</div>
	);
}

function Facts({ items }: { items: Array<[string, ReactNode]> }) {
	return (
		<dl className="facts">
			{items.map(([name, value]) => (
				<div key={name}>
					<dt>{name}</dt>
					<dd>{value}</dd>
				</div>
			))}
		</dl>
	);
}

function Profile({ data }: { data: unknown }) {
	const result = obj(data);
	const p = obj(result.profile ?? data);
	const faction = obj(p.faction);
	const stats = obj(p.battlestats ?? p);
	const cooldowns = obj(p.cooldowns);
	const bar = (key: string) => {
		const b = obj(p[key]);
		return b.current == null || b.maximum == null ? 'Unavailable' : `${text(b.current)} / ${text(b.maximum)}`;
	};
	const seconds = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? `${text(value)}s` : 'Unavailable');
	return (
		<>
			<div className="result-heading">
				<div>
					<p className="eyebrow">PLAYER PROFILE</p>
					<h3>{text(p.name)}</h3>
					<p>
						ID {text(p.player_id)} · Level {text(p.level)}
					</p>
				</div>
				<span className="badge">
					{result.isLinkedProfile === true ? 'Linked profile' : result.isLinkedProfile === false ? 'Public profile' : 'Profile'}
				</span>
			</div>
			<Facts
				items={[
					['Status', status(p.status)],
					['Last action', lastAction(p.last_action)],
					['Faction', faction.name ? `${text(faction.name)} · ${text(faction.position)}` : 'None or unavailable'],
					['Days in faction', text(faction.days_in_faction)]
				]}
			/>
			<div className="result-grid">
				<section>
					<h4>Bars</h4>
					<Facts items={['energy', 'nerve', 'happy', 'life'].map((k) => [k, bar(k)])} />
				</section>
				<section>
					<h4>Cooldowns</h4>
					<Facts items={['drug', 'medical', 'booster'].map((k) => [k, seconds(cooldowns[k])])} />
				</section>
				<section>
					<h4>Battle stats</h4>
					<Facts items={['strength', 'defense', 'speed', 'dexterity', 'total'].map((k) => [k, text(stats[k])])} />
				</section>
			</div>
		</>
	);
}

function Members({ data, unregistered = false }: { data: unknown; unregistered?: boolean }) {
	const report = obj(data);
	const members = Array.isArray(data) ? data : list(report.members);
	return (
		<>
			<p className="subtle">
				{unregistered
					? `${members.length} unregistered of ${text(report.factionMemberCount)} returned members.`
					: `${members.length} members returned.`}
			</p>
			{members.length === 0 ? (
				<p className="empty">
					{unregistered && typeof report.factionMemberCount === 'number' && report.factionMemberCount > 0
						? 'All returned members are registered.'
						: 'No members returned.'}
				</p>
			) : (
				<div className="table-wrap">
					<table>
						<thead>
							<tr>
								<th scope="col">Player</th>
								<th scope="col">Position</th>
								<th scope="col">Level</th>
								<th scope="col">Status</th>
								<th scope="col">Last action</th>
							</tr>
						</thead>
						<tbody>
							{members.map((entry, index) => {
								const m = obj(entry);
								return (
									<tr key={`${text(m.id)}-${index}`}>
										<td>
											<strong>{text(m.name)}</strong>
											<small>ID {text(m.id)}</small>
										</td>
										<td>{text(m.position)}</td>
										<td>{text(m.level)}</td>
										<td>{status(m.status)}</td>
										<td>{lastAction(m.last_action)}</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
}

function FactionInfo({ data }: { data: unknown }) {
	const report = obj(data);
	const basic = obj(report.basic ?? data);
	const chain = obj(report.chain);
	const leader = list(report.members)
		.map(obj)
		.find((member) => member.id === basic.leader_id);
	return (
		<>
			<div className="result-heading">
				<div>
					<p className="eyebrow">FACTION OVERVIEW</p>
					<h3>
						{text(basic.name)} {basic.tag ? `[${text(basic.tag)}]` : ''}
					</h3>
					<p>ID {text(basic.id)}</p>
				</div>
			</div>
			<Facts
				items={[
					['Leader', leader ? `${text(leader.name)} (ID ${text(basic.leader_id)})` : text(basic.leader_id)],
					['Members', text(basic.members)],
					['Respect', text(basic.respect)],
					['Age', basic.days_old == null ? 'Unavailable' : `${text(basic.days_old)} days`],
					['Best chain', text(basic.best_chain)],
					[
						'Current chain',
						chain.current == null ? 'Unavailable' : `${text(chain.current)} / ${text(chain.max)} · ${text(chain.timeout)}s timeout`
					]
				]}
			/>
			<div className="result-grid">
				<section>
					<h4>Territories</h4>
					<p>{list(report.territories).map(text).join(', ') || 'None returned'}</p>
				</section>
				<section>
					<h4>Wars &amp; pacts</h4>
					{list(report.wars).length + list(report.pacts).length === 0 ? (
						<p>None returned</p>
					) : (
						<ul>
							{list(report.wars).map((w, i) => {
								const war = obj(w);
								return (
									<li key={`w${i}`}>
										{text(war.kind)}
										{war.territory ? ` · ${text(war.territory)}` : ''}:{' '}
										{list(war.factions)
											.map((f) => {
												const faction = obj(f);
												return `${text(faction.name)} (${text(faction.score)})`;
											})
											.join(' vs ') || 'Details unavailable'}{' '}
										{war.end === null ? '· Ongoing' : war.end ? `· Ended ${date(war.end)}` : ''}
									</li>
								);
							})}
							{list(report.pacts).map((p, i) => {
								const pact = obj(p);
								return (
									<li key={`p${i}`}>
										Pact: {text(pact.factionName)} · Until {date(pact.until)}
									</li>
								);
							})}
						</ul>
					)}
				</section>
			</div>
		</>
	);
}

function Crimes({ data }: { data: unknown }) {
	const report = obj(data);
	const counts = obj(report.counts);
	const crimes = list(report.crimes);
	return (
		<>
			<Facts
				items={[
					['Recruiting', text(counts.recruiting)],
					['Ongoing (planning)', text(counts.ongoing)],
					['Completed', text(counts.completed)],
					['Last updated', date(counts.lastUpdatedAt)]
				]}
			/>
			<p className="subtle">Completed includes successful and failed crimes. Only recruiting and planning crimes are listed below.</p>
			<p>
				<a href="https://www.torn.com/factions.php?step=your&amp;type=1#faction-crimes" target="_blank" rel="noopener noreferrer">
					Open faction organized crimes in Torn
				</a>
			</p>
			{crimes.length === 0 ? (
				<p className="empty">No recruiting or planning crimes returned.</p>
			) : (
				<div className="crime-list">
					{crimes.map((entry, i) => {
						const crime = obj(entry);
						return (
							<article className="crime" key={`${text(crime.id)}-${i}`}>
								<div className="result-heading">
									<div>
										<h4>{text(crime.name)}</h4>
										<p>
											Difficulty {text(crime.difficulty)} · Ready {date(crime.readyAt)}
										</p>
									</div>
									<span className="badge">{text(crime.status)}</span>
								</div>
								{list(crime.slots).length === 0 ? (
									<p className="subtle">No slot details returned.</p>
								) : (
									<ul className="slots">
										{list(crime.slots).map((entry, j) => {
											const slot = obj(entry);
											const user = obj(slot.user);
											const item = obj(slot.itemRequirement);
											const rate = slot.checkpointPassRate;
											const rateText =
												typeof rate === 'number' && Number.isFinite(rate)
													? `${rate > 70 ? 'Success: ' : rate < 70 ? 'Might fail: ' : ''}${text(rate)}%`
													: 'Pass rate unavailable';
											const missing = slot.user && slot.itemRequirement && item.isAvailable === false;
											return (
												<li key={j}>
													<strong>{text(obj(slot.positionInfo).label ?? slot.position)}</strong>
													<span>
														{slot.user ? text(user.name ?? user.id) : 'Open'} · {rateText}
														{slot.user
															? ` · Status: ${
																	user.outcome === 'Successful'
																		? 'Passed'
																		: user.outcome
																		? `Not passed (${text(user.outcome)})`
																		: 'Pending'
															  }`
															: ''}
													</span>
													{slot.itemRequirement ? (
														<span className={missing ? 'missing' : ''}>
															{missing ? 'Missing item' : slot.user ? 'Item available' : 'Requires'}: {text(item.name)}
														</span>
													) : null}
												</li>
											);
										})}
									</ul>
								)}
							</article>
						);
					})}
				</div>
			)}
		</>
	);
}

export default function App() {
	const [session, setSession] = useState<Session | null>(null);
	const [sessionLoading, setSessionLoading] = useState(true);
	const [sessionError, setSessionError] = useState('');
	const [view, setView] = useState<View>('account');
	const [key, setKey] = useState('');
	const [playerId, setPlayerId] = useState('');
	const [consent, setConsent] = useState({ profile: false, crimes: false });
	const [busy, setBusy] = useState('');
	const [message, setMessage] = useState('');
	const [actionError, setActionError] = useState('');
	const [confirmUnpair, setConfirmUnpair] = useState(false);
	const sessionRequest = useRef<AbortController | null>(null);
	const actionRequest = useRef<AbortController | null>(null);
	const resource = useResource();
	const refreshSession = useCallback(async () => {
		sessionRequest.current?.abort();
		const current = new AbortController();
		sessionRequest.current = current;
		setSessionLoading(true);
		setSessionError('');
		try {
			const next = await request<Session>('/api/session', { signal: current.signal });
			if (
				!next ||
				typeof next !== 'object' ||
				!('user' in next) ||
				(next.user !== null && (!next.user || typeof next.user.id !== 'string' || typeof next.user.username !== 'string')) ||
				(next.csrfToken !== null && typeof next.csrfToken !== 'string') ||
				!next.consent ||
				typeof next.consent.profile !== 'boolean' ||
				typeof next.consent.crimes !== 'boolean' ||
				typeof next.paired !== 'boolean'
			)
				throw new Error('The server returned an invalid session.');
			if (!current.signal.aborted) {
				setSession(next);
				setConsent(next.consent);
			}
		} catch (e) {
			if (!current.signal.aborted) {
				setSession(null);
				setSessionError(e instanceof Error ? e.message : 'Unable to load session.');
			}
		} finally {
			if (sessionRequest.current === current) {
				sessionRequest.current = null;
				setSessionLoading(false);
			}
		}
	}, []);
	useEffect(() => {
		void refreshSession();
		return () => {
			sessionRequest.current?.abort();
			actionRequest.current?.abort();
		};
	}, [refreshSession]);
	const changeView = (next: View) => {
		resource.reset();
		setKey('');
		setConfirmUnpair(false);
		setMessage('');
		setActionError('');
		setView(next);
	};
	const mutate = async (name: string, path: string, body?: unknown, secret?: string) => {
		if (busy || !session) return;
		const current = new AbortController();
		actionRequest.current = current;
		setBusy(name);
		setMessage('');
		setActionError('');
		resource.reset();
		try {
			await request(path, { method: 'POST', token: session.csrfToken ?? undefined, body, signal: current.signal });
			if (!current.signal.aborted) {
				setMessage(`${name} complete.`);
				setConfirmUnpair(false);
				await refreshSession();
			}
		} catch (e) {
			if (!current.signal.aborted) {
				const detail = e instanceof Error ? e.message : 'The request failed.';
				setActionError(secret ? detail.split(secret).join('[redacted]') : detail);
			}
		} finally {
			if (actionRequest.current === current) {
				actionRequest.current = null;
				setBusy('');
			}
		}
	};
	const cancelAction = () => {
		actionRequest.current?.abort();
		actionRequest.current = null;
		setBusy('');
		setKey('');
		setMessage('Request cancelled. Checking your account status; the server may still have processed it.');
		void refreshSession();
	};
	const pair = (event: FormEvent) => {
		event.preventDefault();
		const apiKey = key.trim();
		if (!apiKey) {
			setActionError('Enter your Torn API key.');
			return;
		}
		setKey('');
		void mutate('Pairing', '/api/pair', { apiKey }, apiKey);
	};
	const lookup = (event: FormEvent) => {
		event.preventDefault();
		const id = playerId.trim();
		if (id && (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))) {
			resource.reset();
			setActionError('Enter a valid positive player ID.');
			return;
		}
		setActionError('');
		void resource.load(`/api/profile${id ? `?playerId=${encodeURIComponent(id)}` : ''}`);
	};
	const canUse = !!session?.user && session.paired && !sessionLoading && !busy;
	return (
		<div className="app-shell">
			<a className="skip-link" href="#main">
				Skip to content
			</a>
			<header className="topbar">
				<div className="brand">
					<span className="brand-mark">T</span>
					<div>
						<strong>Token</strong>
						<small>TORN DASHBOARD</small>
					</div>
				</div>
				<div className="top-account">
					{session?.user ? (
						<>
							<span className="user-name">{session.user.username}</span>
							<button
								className="button ghost"
								disabled={!!busy || sessionLoading}
								onClick={() => void mutate('Sign out', '/api/logout')}
							>
								Sign out
							</button>
						</>
					) : !sessionLoading && !sessionError ? (
						<a className="button primary" href="/auth/discord">
							Sign in with Discord
						</a>
					) : null}
				</div>
			</header>
			<div className="layout">
				<aside className="sidebar">
					<p className="nav-label">WORKSPACE</p>
					<nav aria-label="Dashboard sections">
						<button
							className={view === 'account' ? 'active' : ''}
							aria-current={view === 'account' ? 'page' : undefined}
							onClick={() => changeView('account')}
						>
							<span aria-hidden="true">◈</span> Account
						</button>
						<button
							className={view === 'profile' ? 'active' : ''}
							aria-current={view === 'profile' ? 'page' : undefined}
							onClick={() => changeView('profile')}
						>
							<span aria-hidden="true">◎</span> Player profile
						</button>
						<p className="nav-label">FACTION</p>
						{(['info', 'members', 'unregistered', 'organized-crime'] as View[]).map((v) => (
							<button
								key={v}
								className={view === v ? 'active' : ''}
								aria-current={view === v ? 'page' : undefined}
								onClick={() => changeView(v)}
							>
								<span aria-hidden="true">◇</span> {labels[v]}
							</button>
						))}
					</nav>
					<div className="sidebar-note">Your Torn data, on your terms.</div>
				</aside>
				<main id="main">
					<div className="page-heading">
						<div>
							<p className="eyebrow">TOKEN / {view === 'account' || view === 'profile' ? 'WORKSPACE' : 'FACTION'}</p>
							<h1>{labels[view]}</h1>
							<p>
								{view === 'account'
									? 'Manage your connection and sharing preferences.'
									: view === 'profile'
									? 'Look up your own profile or another player.'
									: 'Explore your faction data when you need it.'}
							</p>
						</div>
					</div>
					{sessionLoading && (
						<Notice>
							Loading your session…{' '}
							<button
								className="text-button"
								onClick={() => {
									sessionRequest.current?.abort();
									sessionRequest.current = null;
									setSession(null);
									setSessionLoading(false);
									setSessionError('Session request cancelled.');
								}}
							>
								Cancel request
							</button>
						</Notice>
					)}
					{sessionError && (
						<Notice error>
							{sessionError}{' '}
							<button className="text-button" onClick={() => void refreshSession()}>
								Retry
							</button>
						</Notice>
					)}
					{!sessionLoading && !sessionError && !session?.user && (
						<section className="card welcome">
							<p className="eyebrow">WELCOME TO TOKEN</p>
							<h2>Connect to your Torn world</h2>
							<p>Sign in with Discord to manage your account and view Torn data.</p>
							<a className="button primary" href="/auth/discord">
								Sign in with Discord <span aria-hidden="true">→</span>
							</a>
						</section>
					)}
					{session?.user && (
						<>
							{message && <Notice>{message}</Notice>}
							{actionError && <Notice error>{actionError}</Notice>}
							{busy && (
								<Notice>
									{busy} in progress…{' '}
									<button className="text-button" onClick={cancelAction}>
										Cancel request
									</button>
								</Notice>
							)}
							{view === 'account' ? (
								<div className="stack">
									<section className="card">
										<div className="card-heading">
											<div>
												<p className="eyebrow">CONNECTION</p>
												<h2>Torn account</h2>
												<p>Signed in as {session.user.username}</p>
											</div>
											<span className={`badge ${session.paired ? 'success' : ''}`}>
												{session.paired ? 'Paired' : 'Not paired'}
											</span>
										</div>
										<p>
											Your Torn API key is submitted securely to the server for pairing. It is not stored in this browser. Never
											enter your Torn password.
										</p>
										<p>
											Your key is encrypted in the bot database until you unpair. On Discord, other paired users can request
											your linked profile and see its private bars, cooldowns and battle stats; with the leader's consent the
											leader's key can also be used for a faction crime report posted in the configured channel. Website sharing
											requires the separate choices below; replacing or unpairing your key resets them.
										</p>
										<form onSubmit={pair} autoComplete="off">
											<label htmlFor="api-key">{session.paired ? 'Replace API key' : 'Torn API key'}</label>
											<div className="input-row">
												<input
													id="api-key"
													type="password"
													value={key}
													onChange={(e) => setKey(e.target.value)}
													autoComplete="off"
													placeholder="Enter your API key"
													disabled={sessionLoading || !!busy}
												/>
												<button className="button primary" disabled={sessionLoading || !!busy || !key.trim()}>
													{session.paired ? 'Replace key' : 'Pair account'}
												</button>
											</div>
										</form>
										{session.paired && (
											<div className="actions">
												<button
													className="button secondary"
													disabled={sessionLoading || !!busy}
													onClick={() => void mutate('Verification', '/api/verify')}
												>
													Verify key
												</button>
												{!confirmUnpair ? (
													<button
														className="button danger-outline"
														disabled={sessionLoading || !!busy}
														onClick={() => setConfirmUnpair(true)}
													>
														Unpair
													</button>
												) : (
													<div className="confirm">
														<span>Remove your paired key?</span>
														<button
															className="button danger"
															disabled={sessionLoading || !!busy}
															onClick={() => void mutate('Unpairing', '/api/unpair')}
														>
															Confirm unpair
														</button>
														<button className="button ghost" onClick={() => setConfirmUnpair(false)}>
															Cancel
														</button>
													</div>
												)}
											</div>
										)}
									</section>
									<section className="card">
										<div className="card-heading">
											<div>
												<p className="eyebrow">PRIVACY</p>
												<h2>Website sharing consent</h2>
												<p>Choose how your paired key may be used for website requests.</p>
											</div>
										</div>
										<div className="disclosure">
											These choices apply to the website. Profile consent allows other website users to request your linked
											profile using your paired key, subject to its permissions. Leader consent allows website organized-crime
											requests for your faction to use your key when you are its leader; the key needs Faction API Access. Your
											key is never displayed to other users. You can withdraw consent here at any time.
										</div>
										<form
											onSubmit={(e) => {
												e.preventDefault();
												void mutate('Consent update', '/api/consent', consent);
											}}
										>
											<label className="check">
												<input
													type="checkbox"
													checked={consent.profile}
													onChange={(e) => setConsent({ ...consent, profile: e.target.checked })}
													disabled={sessionLoading || !!busy}
												/>
												<span>
													<strong>Share linked profile</strong>
													<small>Allow website profile lookups to use my paired key.</small>
												</span>
											</label>
											<label className="check">
												<input
													type="checkbox"
													checked={consent.crimes}
													onChange={(e) => setConsent({ ...consent, crimes: e.target.checked })}
													disabled={sessionLoading || !!busy}
												/>
												<span>
													<strong>Allow leader organized-crime access</strong>
													<small>Allow website faction crime requests to use my key if I am the leader.</small>
												</span>
											</label>
											<button
												className="button secondary"
												disabled={
													sessionLoading ||
													!!busy ||
													(consent.profile === session.consent.profile && consent.crimes === session.consent.crimes)
												}
											>
												Save preferences
											</button>
										</form>
									</section>
								</div>
							) : (
								<section className="card">
									{!session.paired && (
										<Notice>
											Pair your Torn account before requesting data.{' '}
											<button className="text-button" onClick={() => changeView('account')}>
												Go to account
											</button>
										</Notice>
									)}
									{view === 'profile' ? (
										<form onSubmit={lookup}>
											<label htmlFor="player-id">
												Player ID <span className="subtle">(optional)</span>
											</label>
											<p className="field-help">Leave blank to view your own profile.</p>
											<div className="input-row">
												<input
													id="player-id"
													type="text"
													inputMode="numeric"
													value={playerId}
													onChange={(e) => setPlayerId(e.target.value)}
													placeholder="e.g. 123456"
													disabled={!canUse || resource.loading}
												/>
												<button className="button primary" disabled={!canUse || resource.loading}>
													Look up profile
												</button>
											</div>
										</form>
									) : (
										<div className="fetch-intro">
											<div>
												<h2>{labels[view]}</h2>
												<p>Data is only fetched when you request it; this page does not refresh automatically.</p>
											</div>
											<button
												className="button primary"
												disabled={!canUse || resource.loading}
												onClick={() => void resource.load(`/api/faction/${view}`)}
											>
												Load {labels[view].toLowerCase()}
											</button>
										</div>
									)}
									{resource.loading && (
										<Notice>
											Loading {labels[view].toLowerCase()}…{' '}
											<button className="text-button" onClick={resource.cancel}>
												Cancel request
											</button>
										</Notice>
									)}
									{resource.error && <Notice error>{resource.error}</Notice>}
									{resource.loaded && (
										<div className="results">
											<p className="subtle">Fetched {resource.loadedAt?.toLocaleString()}</p>
											{view === 'profile' ? (
												<Profile data={resource.data} />
											) : view === 'info' ? (
												<FactionInfo data={resource.data} />
											) : view === 'organized-crime' ? (
												<Crimes data={resource.data} />
											) : (
												<Members data={resource.data} unregistered={view === 'unregistered'} />
											)}
										</div>
									)}
								</section>
							)}
						</>
					)}
				</main>
			</div>
		</div>
	);
}
