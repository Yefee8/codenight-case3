# State Machine, SLA ve Concurrency Notları

State enum tek başına state machine değildir; izinli `from→to`, actor, guard ve side effect birlikte
tanımlanır. Default deny, beklenmeyen yeni enum geçişini engeller. Optimistic version iki insan
kararından stale olanı `409` yapar.

SLA in-memory timer olmamalıdır: restart kaybeder. DB `due_at`, scheduler `SKIP LOCKED`, breach
unique flag/event restart-safe olur. Clock inject edilirse tam deadline deterministik test edilir.

Capacity “önce say sonra insert” ile race'te 10'u aşar. Row lock/conditional update reservation
aynı DB transaction'ında olmalıdır. AI aday sıralar ama kesin reservation Transaction'a aittir.

FraudCell'te reassignment SLA'yı resetlemez; de-escalation deadline uzatmaz; exact
`decided_at <= due_at` zamanında sayılır.

