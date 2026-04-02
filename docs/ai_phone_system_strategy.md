# CorePOS AI Phone System Strategy

## Current State

- VoIPfone is the active SIP carrier and phone backbone.
- Yealink handsets are the live shop phones in production.
- The current telephony setup is working and should remain the reliable production path for now.
- The shop number should stay with VoIPfone rather than being ported to Dialpad later unless there is a very strong operational reason to change that.

## Core Recommendation

The preferred strategy is to keep VoIPfone as the telecom backbone while starting Twilio in parallel as the future AI and integration platform.

- Keep VoIPfone live for real shop calls.
- Start Twilio immediately as the long-term integration layer.
- Do not put Twilio directly in the live call path yet.
- Build Twilio alongside the working production phone system first.

This is the smarter path because it protects the shop's current phone reliability while still moving CorePOS toward the right long-term architecture.

## Staged Architecture

### Phase 1: Current Reliable Production Setup

Current production should stay simple and dependable.

```text
Customer
  -> VoIPfone
    -> Yealink phones
```

### Phase 2: Parallel AI Layer

Twilio runs alongside the live phones for logging, transcription, analytics, and future event capture, but it is still not responsible for live routing.

```text
Customer
  -> VoIPfone
    -> Yealink phones

Twilio
  -> logging
  -> transcription
  -> analytics
  -> future event capture
```

### Phase 3: Controlled Routing Layer

Twilio starts to handle more routing and AI logic, but VoIPfone still remains the telecom backbone.

```text
Customer
  -> VoIPfone
    -> Twilio routing / AI layer
      -> Yealink phones
      -> future automation paths
```

### Phase 4: Full CorePOS Integration

CorePOS becomes call-aware and can connect telephony to customer, workshop, and follow-up workflows.

```text
Customer
  -> VoIPfone backbone
    -> Twilio routing / AI layer
      -> CorePOS call-aware workflows
        -> customer matching
        -> transcript linkage
        -> missed-call tasks
        -> workshop / job linkage
        -> reporting
```

## Why Not Go Full Twilio Immediately

Twilio is strategically right long-term, but making it the only live system today introduces unnecessary risk.

- It adds more telephony complexity up front.
- It increases reliability risk for live shop calls.
- It brings routing and telephony edge cases before CorePOS has enough real call data.
- It risks breaking the current production phone experience.
- It creates more debugging and support burden at the wrong stage.
- It turns product infrastructure work into an urgent phone replacement project.

## Why This Staged Path Is Better

- Reliable shop phones stay live.
- There is no need to re-port numbers later just to experiment with AI features.
- It avoids unnecessary vendor lock-in.
- It lets the team learn real call patterns before automating them.
- Twilio can be developed as CorePOS product infrastructure rather than rushed telephony replacement.
- It fits the long-term CorePOS direction better: operational reliability first, deeper integration second.

## Immediate Next Steps

- Keep VoIPfone as the live carrier.
- Keep the main number port on VoIPfone.
- Add call queue or concurrency improvements only if real operational demand requires them.
- Begin designing Twilio integration in parallel.
- Define a CorePOS call event schema.
- Plan for transcription, caller matching, missed-call workflows, and workshop linkage.
- Avoid overbuilding IVR before real usage data exists.

## Suggested Future Implementation Targets

- Call event ingestion
- Transcript storage
- Customer phone matching
- Missed-call follow-up task creation
- Workshop and job linking
- Reporting and analytics
- Optional AI-assisted routing once real call patterns are known
