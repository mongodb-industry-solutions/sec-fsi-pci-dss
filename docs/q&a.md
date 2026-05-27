### Questions and Answers about PCI DSS

#### **1. What is PCI DSS?**  
**Answer:**  
PCI DSS (Payment Card Industry Data Security Standard) is an information security standard developed by the PCI Security Standards Council, and applies to all entities that store, process, and/or transmit cardholder data.

---

#### **2. Is MongoDB Cloud PCI DSS certified?**  
**Answer:**  
Currently, MongoDB Cloud has achieved PCI DSS 4.0 as of September 2023.

---

#### **3. I am a PCI DSS merchant. Can I store cardholder data on MongoDB Cloud?**  
**Answer:**  
Yes. MongoDB Cloud is a PCI DSS certified service provider. Depending on a customer’s selection, MongoDB Atlas runs MongoDB on Amazon Web Services (AWS), Google Cloud Platform (GCP), and/or Microsoft Azure, which are each PCI DSS compliant. More details about PCI DSS compliance for these cloud providers can be found on their respective websites:  
   - [Amazon Web Services (AWS)](https://aws.amazon.com/security/pci-dss/)  
   - [Google Cloud Platform (GCP)](https://cloud.google.com/security/compliance/pci-dss)  
   - [Microsoft Azure](https://azure.microsoft.com/en-us/overview/compliance/pci-dss/).

---

#### **4. If I use MongoDB Cloud for storing, processing, and/or transmitting cardholder data, will I be automatically compliant with PCI DSS?**  
**Answer:**  
No. Customers must manage their own PCI DSS compliance certification, and additional testing will be required to verify that your environment satisfies all PCI DSS requirements. However, for the portion of the PCI cardholder data environment (CDE) in MongoDB Cloud, your Qualified Security Assessor (QSA) can rely on the MongoDB Cloud Attestation of Compliance (AOC) without further testing.

---

#### **5. Where can I download the PCI DSS certificate for MongoDB Cloud?**  
**Answer:**  
The MongoDB Cloud PCI Attestation of Compliance (AOC) is available upon request.  

   - Existing customers can request documentation [here](https://www.mongodb.com/contact).  
   - Prospective customers, please contact us [here](https://www.mongodb.com/contact).

---

#### **6. Which security features can help towards my PCI DSS compliance?**  
**Answer:**  
There are several features available in MongoDB Atlas that may help towards PCI DSS compliance, including:  
   - Configure federated identity with an identity provider.  
   - Create clusters with TLS (Transport Layer Security) 1.2 support by default.  
   - Set up network peering or a Private Endpoint so that cardholder data is always encrypted over private networks between your cloud environment and Atlas.  
   - Enable database auditing.  
   - Use client-side field-level encryption to encrypt document fields before they are sent to MongoDB Atlas.

---

#### **7. Who is the Qualified Security Assessor (QSA) for MongoDB?**  
**Answer:**  
Schellman Compliance, LLC is the independent QSA for MongoDB.

---

#### **8. Which MongoDB services are in the scope of the PCI DSS certification?**  
**Answer:**  
The scope of PCI DSS 4.0 certification includes MongoDB Atlas, MongoDB App Services on Atlas, MongoDB Charts, MongoDB Serverless on Atlas, Cloud Manager, MongoDB Data Federation on Atlas, MongoDB Search on Atlas, and MongoDB Atlas for Government. Any products or features that are in beta, preview, or similar are not in scope.

---

**Source:**  
For more details, visit MongoDB's official page: [Trust Center - PCI DSS](https://www.mongodb.com/products/platform/trust/pci-dss).

---

### Technical Q&A: QE Design, Certification Architecture, and Payment Data Compliance

*These questions emerged from expert review of the demo architecture. They are likely to surface from security architects, QSAs, and technically sophisticated FSI prospects.*

---

#### **9. Why is the card token (payment token) stored in plaintext and not encrypted with Queryable Encryption?**

**Answer:**  
A properly implemented payment token is a surrogate for the Primary Account Number (PAN). Under PCI DSS v4.0, a token that meets the requirements of the standard (irreversible, or reversible only through a controlled token vault with additional authentication factors) is **not classified as cardholder data** and therefore does not require the same protections as a PAN. Encrypting it with Queryable Encryption and presenting that as a PCI requirement would be technically incorrect and could mislead a security-aware audience.

The demo stores `paymentCardReference` as a plaintext indexed field and searches it via a standard MongoDB index. The QE encryption story focuses on the fields that genuinely are PII or CHD under the standard: `customerEmailAddress`, `customerMobilePhoneNumber`, and `cardTransactionAccountReference`. This is the correct and accurate representation of what PCI DSS v4.0 requires.

**Key principle:** Encrypt what the standard requires, and nothing more. Over-encrypting non-sensitive fields obscures the real story and raises questions about whether the design team understands the standard.

---

#### **10. Does the demo need to mention magnetic stripe (track) data in the SAD prohibition list?**

**Answer:**  
No, for this specific use case. PCI DSS v4.0 defines three categories of Sensitive Authentication Data (SAD) that must never be stored after authorization: card verification codes (CVV/CVC2), PINs, and full track data (magnetic stripe or chip equivalent). Track data is only relevant in **Card Present** transactions where a physical card is swiped, tapped, or inserted.

This demo simulates an **online checkout (Card Not Present)** transaction where the bank receives a payment token, not a PAN or track data. Track data is never transmitted or received in this flow, so prohibiting its storage is moot. Adding it to the SAD notes would imply the system is a point-of-sale terminal, which it is not.

The existing SAD prohibition list (CVV, PIN) is accurate and sufficient for this use case. The `magneticStripeData: PROHIBITED` note in the schema comments serves as completeness documentation for general PCI awareness, not as a scenario-specific rule.

---

#### **11. What is the difference between Sensitive Authentication Data (SAD) and Cardholder Data (CHD) under PCI DSS?**

**Answer:**  
PCI DSS v4.0 defines two overlapping categories within account data:

**Cardholder Data (CHD):** May be stored after authorization if protected per the standard.
- Primary Account Number (PAN), must be rendered unreadable if stored
- Cardholder name
- Expiration date
- Service code

**Sensitive Authentication Data (SAD):** Must NEVER be stored after authorization, even encrypted.
- Full magnetic stripe data (track 1, track 2, or equivalent chip data)
- Card verification codes (CAV2, CVC2, CVV2, CID)
- PINs and PIN blocks

The critical distinction is that SAD cannot be retained post-authorization under any circumstances, while CHD can be stored if appropriate protections are in place (encryption, access control, key management). This demo demonstrates the correct approach: card tokens (surrogates) and masked PANs are displayed; expiry dates are stored as QE:none; CVV and PIN are never accepted or stored at any API endpoint.

---

#### **12. Why does the demo encrypt the card expiration date (QE:none) if the payment token is stored plaintext?**

**Answer:**  
The expiry date is different from the token. Under PCI DSS v4.0, the expiration date is classified as **Cardholder Data (CHD)** when stored in conjunction with a PAN. In this demo it is stored alongside `paymentCardReference` (the token) and `maskedPanDisplay`. Whether the token is itself CHD or not, the expiry date co-located with card account data is a more conservative classification, and the cost of protecting it with QE:none is negligible.

The QE:none mode also serves a demo purpose: it illustrates the "non-searchable sensitive field" pattern, where data is encrypted but not queryable and is visible only after decryption with the correct DEK. This is the same pattern used for `residentialAddressFull` and `governmentIdentificationReference` in the escalation workflow.

---

#### **13. How does MongoDB Queryable Encryption differ from standard encryption or field-level encryption (CSFLE)?**

**Answer:**  
There are three relevant encryption approaches in MongoDB:

| Approach | Where encrypted | Searchable | Key holder |
|---|---|---|---|
| **Encryption at rest** (Atlas default) | Storage layer | No | MongoDB (platform) |
| **Client-Side Field Level Encryption (CSFLE)** | Application client | Limited (explicit) | Customer |
| **Queryable Encryption (QE)** | Application client | Yes (equality, range) | Customer |

QE is the evolution of CSFLE. Both encrypt fields before the data reaches the server, and both require the customer to hold the keys (via AWS KMS or similar). The key difference is that QE supports equality and range queries on encrypted fields using a cryptographic metadata structure, without decrypting the field on the server side. CSFLE in "explicit" mode can do deterministic encryption for equality queries but lacks the range query capability and has a different key derivation model.

This demo uses QE only (not CSFLE) to simplify the architecture and the explainability narrative.

---

#### **14. If the token is not CHD, why does the demo use tokenization at all? What security problem does it solve?**

**Answer:**  
Tokenization solves a different problem than encryption. The goal of tokenization is to **remove the PAN from the payment flow entirely**: the merchant, the issuing bank's application layer, and all downstream systems that do not need the actual card number receive only a token. This limits the number of systems that ever touch the real PAN to the token vault (typically operated by the payment network or a PSP), which dramatically reduces PCI DSS scope.

In this demo, the client-side code generates a token before the API call. The raw PAN never travels over the network and is never stored anywhere in the system. The token is then used as the card identifier for all subsequent operations: transaction lookup, fraud investigation, recurring payment. QE encryption handles the PII fields (email, phone, account reference) that remain in scope for privacy protection even after tokenization removes the PAN risk.

The combination of tokenization (removes PAN risk) and QE (protects PII) represents a defense-in-depth posture appropriate for a digital bank.

---

#### **15. Can a QSA rely on the MongoDB Atlas AOC for the QE encryption layer of my application?**

**Answer:**  
Partially. The MongoDB Atlas AOC covers the certified PCI DSS scope of the platform: the storage, network, and infrastructure layer. It does not cover your application's implementation of QE, key management practices, or how you handle the Data Encryption Keys (DEKs) and Customer Master Key (CMK).

Your QSA will need to assess:
- How the CMK is managed in AWS KMS (Requirement 3.6)
- How DEKs are provisioned and rotated
- How the application client (backend service) holds and uses the KMS credentials
- Whether access to the decryption capability is role-restricted (Requirement 7)
- Whether every field-access event is audited (Requirement 10)

The demo is designed to demonstrate all of these controls in a way that supports a QSA conversation. The MongoDB AOC reduces the burden of assessing the platform layer; your assessor applies their judgment to the application layer.

---

#### **16. Does encrypting PII fields with QE put them outside PCI DSS scope?**

**Answer:**  
Not automatically. PCI DSS scope is primarily determined by the presence of **cardholder data (CHD)**, specifically the PAN. Fields like email address and phone number are PII but are not CHD under PCI DSS. They would be in scope for other regulatory frameworks (GDPR, CCPA) but their presence does not extend your PCI CDE.

If the QE-encrypted fields contain a PAN (even tokenized), the collection would still be evaluated as part of the CDE. If those fields contain only PII (email, phone), they are subject to privacy regulation but do not expand PCI scope. The design choice to encrypt PII with QE in this demo is primarily a privacy and defense-in-depth decision, not a PCI scoping reduction strategy.

Scope reduction in PCI DSS is better achieved through tokenization (removing the PAN from downstream systems) and network segmentation (Private Endpoint, VPC peering), both of which this architecture demonstrates.

---

*Atlas PCI DSS certification and QE architecture*

---

#### **17. What does the MongoDB Atlas PCI DSS certification actually cover, and what remains the customer's responsibility?**

**Answer:**
The Atlas PCI DSS 4.0 AOC (Attestation of Compliance) means Schellman Compliance, LLC assessed MongoDB's cloud database service and found it meets PCI DSS requirements for how MongoDB operates the platform as a service provider. The critical insight is that there are two completely separate layers of responsibility:

```
+----------------------------------------------------------+
|  LAYER 2: Customer app (customer's responsibility)       |
|  QE, AWS KMS, app RBAC, SAD prohibition, tokenization    |
|  NOT covered by the Atlas AOC                            |
+----------------------------------------------------------+
|  LAYER 1: Atlas platform (MongoDB's responsibility)      |
|  Encryption at rest, TLS, network, audit infrastructure  |
|  Covered by the AOC -- assessed by Schellman, not by     |
|  the customer                                            |
+----------------------------------------------------------+
```

The AOC covers Layer 1 only. The customer's own PCI DSS compliance program must cover Layer 2 independently.

**What the AOC covers (Layer 1, MongoDB's responsibility):**

| PCI DSS Requirement | Atlas feature |
|---|---|
| Req 1-2 (Network security) | IP Access Lists, VPC (Virtual Private Cloud) Peering, Private Endpoints (AWS PrivateLink, Azure Private Link, GCP Private Service Connect), tenant isolation between clusters |
| Req 3.4 (CHD unreadable at rest) | AES-256 (Advanced Encryption Standard) encryption at rest on all storage volumes and backup media |
| Req 4 (Encryption in transit) | TLS 1.2+ enforced on all client connections |
| Req 7-8 (Access control and authentication) | Atlas RBAC (Role-Based Access Control), MFA (Multi-Factor Authentication) on Atlas console, LDAP (Lightweight Directory Access Protocol) integration, MongoDB employee privileged access management |
| Req 10 (Audit logging) | Atlas Audit Log infrastructure, maintained and secured by MongoDB |
| Req 11-12 (Vulnerability management) | MongoDB patching program, security scanning, and information security policies |

Physical security is inherited from AWS, GCP, and Azure, which are each PCI DSS certified independently.

**What the AOC does NOT cover (Layer 2, customer's responsibility):**

- Application code and its security practices.
- How QE or CSFLE or any application-side encryption is implemented.
- Customer-managed key practices: the CMK in AWS KMS, DEK rotation schedules, and the KMS key policy.
- Application-level access control and field visibility logic (for example, Level 1 vs Level 2 analyst roles in this demo).
- Network topology outside Atlas: the customer's VPC, application servers, and service mesh.
- Whether the application ever accepts or stores CVV, PIN, or full PAN.
- Any Atlas product currently in beta or preview status.

The AOC reduces the QSA assessment burden for the platform layer so the assessor can focus time and effort on the application layer.

---

#### **18. Is Queryable Encryption (QE) required for Atlas to be PCI DSS certified? What specific PCI DSS requirements does it address?**

**Answer:**
QE is not what certifies Atlas. The certification is based on platform-level controls: AES-256 at rest, TLS in transit, network security, and MongoDB's operational security program. Atlas was PCI DSS certified before QE existed as a product.

QE is an application-side control that the customer deploys in their backend service, on top of the platform certification. To understand why it adds material security value beyond what the AOC already covers, consider what each layer protects against:

| Threat scenario | AES-256 at rest (Layer 1, Atlas) | QE client-side encryption (Layer 2, application) |
|---|---|---|
| Attacker steals physical disk or backup media | Protected | Protected |
| Attacker compromises Atlas account credentials | Not protected: the disk is decrypted to serve any authenticated query | Protected: Atlas stores only ciphertext regardless of who authenticates |
| MongoDB internal access (employee, support tooling) | Not protected: Atlas decrypts internally before processing queries | Protected: Atlas never receives a decryptable value |
| Plaintext CHD in slow query logs or explain plans | Not protected | Protected: only ciphertext appears in any server-side log |
| Application-layer attacker with backend code but no KMS access | Not protected | Protected: without the CMK, the DEK cannot be unwrapped |

QE directly addresses specific PCI DSS v4.0 requirements that the platform layer alone cannot satisfy:

**Req 3.4 (CHD must be unreadable at rest):** Atlas AES-256 encryption satisfies this at the storage layer. QE provides a stronger guarantee: the CHD field is encrypted before the BSON (Binary JSON) document leaves the application server. MongoDB never receives the plaintext, so it cannot appear in any server-side process, memory snapshot, query log, or diagnostic tool.

**Req 3.6 (Key management):** The CMK is held exclusively by the customer in AWS KMS. The DEK is unwrapped in application process memory only during an active session. MongoDB has zero access to either key. Revoking the CMK in AWS KMS immediately renders all QE-encrypted data unreadable from every system, including Atlas itself.

**Req 7 (Restrict access to CHD by business need):** Atlas RBAC controls who can connect and run queries. QE adds a cryptographic boundary on top: a user with full Atlas admin credentials who queries the collection without the QE client receives only opaque binary ciphertext. The restriction is mathematical, not policy-based, and cannot be bypassed by any administrative action inside Atlas.

**Req 10 (Audit trail of access to CHD):** Every decryption event occurs in the application layer, where it can be logged with full business context: which user, which role, which fraud case, which fields were accessed, and at what timestamp. This produces a richer audit trail than Atlas-level database operation logs alone.

In summary: Atlas certification covers the infrastructure contract. QE covers the data contract. A complete PCI DSS posture requires both.

---

#### **19. How does the "Encrypted in Atlas" toggle in the demo prove that MongoDB cannot read cardholder data?**

**Answer:**
The toggle demonstrates the encryption boundary by calling the same document through two different backend paths and showing the results side by side.

**Decrypted view (normal application path):**
The Fastify backend queries Atlas using the QE-enabled MongoClient. The QE driver contacts AWS KMS to unwrap the DEK, then decrypts the encrypted fields in the application process before returning the document. The response contains readable values: `customerEmailAddress`, `customerMobilePhoneNumber`, `cardTransactionAccountReference`.

**Raw Atlas view (what MongoDB stores):**
A second backend endpoint queries the same document using a plain MongoClient with no QE configuration and no DEK. It receives the BSON document exactly as Atlas stores it on disk. The encrypted fields are opaque binary ciphertext. No MongoDB database administrator, no Atlas console user, and no MongoDB employee can recover the original value from these bytes without the DEK and the CMK.

**Presenter talking point:**
"This is what Atlas sees. Not the email address. Not the account reference. Just encrypted bytes. The only system that can read these fields is your backend service, using your keys, stored in your KMS. MongoDB has zero access to those keys. This is not a contractual promise. It is a mathematical guarantee."

This toggle is the single most effective moment in the demo for answering the question: *"How do we know MongoDB cannot read our cardholder data?"* The answer is not a policy statement. It is a live query result: ciphertext in the database, plaintext in the application, with the only difference being cryptographic key possession.

---

*PAN storage, recurring payment, and BIAN alignment*

---

#### **20. How does the demo satisfy PCI DSS Requirement 3.4 (PAN must be rendered unreadable wherever it is stored)?**

**Answer:**
The demo satisfies Requirement 3.4 through non-storage: the PAN never enters the system at all. The standard requires the PAN to be rendered unreadable wherever it is *stored*; this demo removes it from the flow before any storage decision is needed. See Q14 for how client-side tokenization achieves this.

**What the system stores per card:**

| Field | Value example | Classification | Storage |
|---|---|---|---|
| `paymentCardReference` | `tok_7xB2kp1q` | Card surrogate, not CHD | Plaintext, standard index |
| `maskedPanDisplay` | `**** **** **** 4242` | Permitted for display (last 4 digits) | Plaintext |
| `cardExpirationDate` | `[ciphertext]` | CHD | QE:none (encrypted, non-searchable) |
| CVV / PIN | not present | SAD | Never accepted at any endpoint |

Someone does hold the PAN, but it is the token vault operated by the PSP (Payment Service Provider) or payment network (Visa Token Service, Mastercard MDES). That system is a separately PCI DSS certified environment outside the scope of this demo. This demo represents the issuing bank's application layer, which receives a token after the PSP has already removed the PAN from the flow.

---

#### **21. The demo mentions "save card" as a future feature. How should recurring payment / saved card be implemented to be PCI DSS compliant?**

**Answer:**
Save card for recurring payment is a v4 feature in this demo (not yet implemented). The current architecture already has the correct foundation; v4 needs four additions to existing collections and one new endpoint scope.

**What to store per saved card:**

| Field | Value | Requirement |
|---|---|---|
| `paymentCardReference` | PSP/network token | Not CHD; plaintext storage is correct (see Q9) |
| `maskedPanDisplay` | `**** **** **** 4242` | Permitted for UI display |
| `cardExpirationDate` | `[ciphertext]` | CHD; QE:none already correct |
| `billingAddress` | `[ciphertext]` | PII; QE:none for privacy |
| `cardholderConsentTimestamp` | ISO 8601 datetime | Required: Req 3.1 + network rules |
| `mandateStatus` | `active / cancelled / expired` | Required for Req 3.7 purge logic |

**CVV on file is always prohibited (Requirement 3.3):**
Recurring transactions are "merchant-initiated transactions" under Visa and Mastercard rules and do not require CVV re-entry. The customer's consent is captured once at save-card time; subsequent charges do not re-verify card credentials.

**Four requirements specific to recurring payment:**

**1. Explicit cardholder consent (Req 3.1 + network rules):**
The save-card step must present an explicit consent checkbox and record the `cardholderConsentTimestamp`. Without documented consent, storing card data for future charges violates both PCI DSS and payment network rules.

**2. Scope-limited access to the charge trigger (Req 7):**
Only the payment processing service should be able to initiate a new charge with a stored token. The fraud investigation system, analytics, and Level 1 and Level 2 analysts must not have access to the recurring charge endpoint. In this demo's RBAC model, that endpoint needs a distinct authorization scope separate from investigation roles.

**3. Periodic purge of unused stored cards (Req 3.7):**
Stored card data must be deleted when the customer cancels the mandate, when the card expires and no replacement token is received, or when the agreed retention period ends. The `paymentCardQE` collection needs a `mandateStatus` field and a scheduled cleanup job.

**4. Token lifecycle and automatic card update:**
Network tokens issued by Visa Token Service or Mastercard MDES (Mastercard Digital Enablement Service) can auto-update when the underlying physical card is reissued. This is handled by Visa Account Updater (VAU) and Mastercard Automatic Billing Updater (ABU). The PSP manages this transparently; the bank stores the same `paymentCardReference` and it remains valid even after the physical card number changes.

**What v4 needs to add:**
`cardholderConsentTimestamp` and `mandateStatus` in `paymentCardQE`, a `preferredPaymentCardReference` link in `customerAgreementQE`, a `cardTransactionInitiationType` field in `cardTransactionQE`, and the charge-trigger endpoint with a restricted RBAC scope. See Q22 for how these map to BIAN (Banking Industry Architecture Network) Service Domains.

---

#### **22. How does the save card / recurring payment feature align with BIAN Service Domains?**

**Answer:**
The save card feature does not require a new BIAN Service Domain. In the BIAN model, a customer's authorization to charge a card for future payments is a behavioral capability of the Customer Agreement (SD-53), not a standalone entity. The Customer Agreement already represents the product contract between the bank and the customer; the recurring payment mandate is a feature of that contract, not a separate agreement.

**How save card maps to existing service domains:**

| Action | BIAN Service Domain | Collection | Field additions |
|---|---|---|---|
| Customer saves a card as preferred payment method | Payment Card (SD-88) | `paymentCardQE` | `isPreferredPaymentMethod`, `mandateStatus`, `cardholderConsentTimestamp`, `mandateExpiryDate` |
| Customer grants consent for future charges | Customer Agreement (SD-53) | `customerAgreementQE` | `preferredPaymentCardReference` (link to the saved card) |
| Recurring charge is executed | Card Transaction (SD-254) | `cardTransactionQE` | `cardTransactionInitiationType` (`customerInitiated` / `merchantInitiated`) |

In BIAN terms: saving a card activates a "recurring payment instrument" behavior on the Payment Card service domain. The consent is a qualifier on the Customer Agreement service domain. Merchant-initiated charges are a subtype of Card Transaction.

This means v4 save card is three field extensions across existing collections with no new collection needed. The mandate is expressed through the link between `customerAgreementQE.preferredPaymentCardReference` and `paymentCardQE.mandateStatus`, not through a separate mandate document.

**Why `cardTransactionInitiationType` also matters for compliance:**
Under Visa and Mastercard rules, merchant-initiated transactions have a different authorization flow than customer-initiated ones: they do not require CVV re-entry, they reference the stored consent instead, and they carry a specific network flag that affects interchange rates and chargeback rules. Storing this field in `cardTransactionQE` makes the transaction type explicit to any downstream compliance, fraud analysis, or dispute resolution system.