# FULCRUM - Project Charter

## The idea

FULCRUM is a DeFi position investigator. It starts with one real position,
reconstructs what that position rests on, tests an uncertain dependency with
real evidence, and identifies the smallest credible failure combination that
would make the investor regret staying.

It ends with a financial decision rather than a generic risk score:

> **Hold, reduce, or exit - and at what event probability does that decision change?**

`FULCRUM` is a working name. It describes the point at which a position's
balance changes and is deliberately separate from the earlier `FAULTLINE`
idea.

## The demo promise

In four minutes, a judge should see this sequence:

1. Load one real Pendle PT position and a timestamped market snapshot.
2. Reveal its verified dependency graph, grouped by what preserves **value**,
   **access**, and the investor's ability to **escape**.
3. Investigate one uncertain relationship: present competing explanations,
   retrieve a real piece of evidence, and update its status.
4. Propagate a relevant failure through the graph in explicit economic steps.
5. Search a bounded set of documented shocks to find the least-severe
   combination that crosses a selected loss limit.
6. Compare holding, partial reduction, and exit using an observed execution
   quote or a clearly labelled model, then state the break-even probability.

The memorable moment is not a red dashboard. It is the system showing that an
apparently safe position can lose its **way out** before it loses its value.

## Mathematical spine

### 1. Capability dependency graph

Nodes represent real protocol components and state. Directed edges answer a
specific question: "what capability of this position changes when this node is
impaired?"

Each edge is classified as one or more of:

- **Value** - affects redemption or mark-to-market value.
- **Access** - affects redemption, withdrawal, or settlement.
- **Escape** - affects the ability and cost of reducing exposure.

Every edge carries an evidence record: source, observation time/block,
classification (`observed`, `inferred`, `scenario assumption`, or `unknown`),
and limitations. We do not invent confidence percentages.

### 2. Active evidence selection

For one uncertain dependency, FULCRUM keeps a small set of competing
hypotheses and chooses the available query that best distinguishes them. The
result can confirm, reject, or leave the dependency unresolved. This is a
small, real scientific loop - not an LLM-generated story.

### 3. Failure-path simulation

Scenarios mutate documented state variables and propagate only along explicit
mechanism rules. The initial implementation will support only mechanisms that
are relevant to the selected position, such as underlying repricing and
liquidity deterioration. Each step exposes its inputs, formula, and output.

### 4. Critical-path search

For a selected loss limit, search a bounded, reproducible grid of shock
vectors and minimize a transparent severity measure subject to modeled loss
crossing the limit:

    minimise   severity(shock)
    subject to modeled_loss(position, shock) >= loss_limit

The result is a conditional reverse stress test, not a probability forecast.
FULCRUM also reports the interaction term so it can show when combined shocks
are worse than their isolated effects.

### 5. Decision frontier

For each supported action, calculate:

    action_cost = exit_execution_cost + residual_conditional_loss

When a failure probability is unknown, calculate its break-even value instead
of manufacturing an expected loss:

    break_even_probability = immediate_exit_cost / avoided_conditional_loss

The user can see which uncertain input would reverse the recommendation.

## Scope for the hackathon

### We will build

- One deeply analysed, real Pendle PT case, preferably with verified
  underlying, chain, market, and an applicable oracle or lending relationship.
- A reproducible real-data snapshot, labelled with timestamps and provenance.
- An evidence-backed graph and one genuine active-investigation loop.
- Two meaningful, position-specific failure mechanisms.
- Bounded critical-path search over those mechanisms.
- Hold, full exit, and at least two partial-exit comparisons when execution
  quotes support it.
- An interactive demo, an exportable evidence report, tests for core financial
  calculations, a README, and a short technical report.

### We will not pretend to build

- A universal DeFi risk engine.
- A probability model for hacks without a credible empirical basis.
- A generic contagion coefficient or made-up confidence score.
- Live trading, destructive protocol interactions, or unlabelled mock data.
- More protocol coverage at the cost of a defensible single case.

## Definition of success

| Challenge criterion | What FULCRUM must demonstrate |
| --- | --- |
| Dependency discovery (30%) | Correct, evidenced dependencies and one active test of a genuine uncertainty. |
| Impact estimation (30%) | Traceable inputs, explicit mechanism equations, no double counting, and clear assumptions. |
| Decision usefulness (25%) | A hold/reduce/exit comparison with exit costs and a break-even threshold. |
| Working real-data demo (15%) | A runnable application that can reproduce a timestamped case. |

## Build order

1. Select the real position and data sources. **Completed:** see
   [CASE_SELECTION.md](CASE_SELECTION.md).
2. Define the graph schema and evidence ledger. **Completed:** the live
   dependency-tomography graph and evidence ledger are implemented.
3. Capture and validate the first market snapshot. **Completed:** immutable,
   SHA-256-fingerprinted evidence snapshots can be captured locally.
4. Build dependency discovery and the active test. **Completed:** live
   oracle-vs-exit tomography led to an on-chain proxy and feed trace that
   refutes a direct live-exit oracle dependency.
5. Implement failure mechanics and loss accounting. **Completed:** value,
   escape, and oracle-valuation paths are calculated separately.
6. Implement critical-path search and decision frontier. **Completed:** the
   bounded reverse-stress search now compares hold, partial reductions, and
   full exit using live, read-only PT-to-USDC route quotes.
7. Build the interface around the investigation narrative. **Implemented:**
   clickable dependency inspection, stress curve, quote comparison and evidence
   download. Copy and layout have been revised for plain-language use.
8. Validate calculations and prepare the submission package. **In progress:**
   24 tests pass. Successful live capture remains blocked by environment network
   access. The complete loan-unwind path and additional case validation remain
   open; existing sale quotes must not be presented as executable loan exits.

## Product defaults

- The loss limit is adjustable in the interface and defaults to a 10% loss of
  the analysed position. It is a demonstration setting, not a universal risk
  rule.

## Product audience

FULCRUM is framed for an institutional risk manager. The interface therefore
prioritises position and portfolio impact, evidence provenance, stated
assumptions, reproducibility, and a defensible action recommendation. Plain
language remains a design requirement: the user should not need DeFi expertise
to understand the financial decision.

## Remaining design choice

- Is **FULCRUM** a good working name, or should the product feel darker,
  more scientific, or more institutional?
