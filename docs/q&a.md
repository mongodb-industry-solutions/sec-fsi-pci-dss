### Questions and Answers about PCI DSS

#### **1. What is PCI DSS?**  
**Answer:**  
PCI DSS is an information security standard developed by the PCI Standards Security Council, and applies to all entities that store, process, and/or transmit cardholder data.

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
   - Create clusters with TLS 1.2 support by default.  
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

### Questions and Answers about MongoDB Queryable Encryption and Payment Data Design

*These questions emerged from expert and technical review of the demo architecture. They are likely to surface from security architects, QSAs, and technically sophisticated FSI prospects.*

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

#### **17. What does the MongoDB Atlas PCI DSS certification actually cover, and what remains the customer's responsibility?**

**Answer:**
The Atlas PCI DSS 4.0 Attestation of Compliance (AOC) means Schellman Compliance, LLC assessed MongoDB's cloud database service and found it meets PCI DSS requirements for how MongoDB operates the platform. This assessment is done once by MongoDB; customers can rely on it without repeating the same infrastructure tests in their own audit.

**What the AOC covers (MongoDB's responsibility):**

- Physical security: Atlas runs on AWS, GCP, and Azure, each independently PCI DSS certified.
- Encryption at rest: AES-256 by default on all Atlas storage volumes and backup media.
- Encryption in transit: TLS 1.2 enforced on all client connections to Atlas.
- Network isolation: tenant isolation between clusters, MongoDB-managed firewall rules.
- Platform access controls: Atlas console multi-factor authentication, MongoDB employee access policies, and privileged access management.
- Vulnerability management: MongoDB's patching program and security scanning.
- Atlas audit log infrastructure: MongoDB secures and maintains the audit log system itself.

**What the AOC does NOT cover (customer's responsibility):**

- Your application code and its security practices.
- How you implement QE, CSFLE, or any application-side encryption.
- Your key management practices for customer-managed keys (CMK in AWS KMS).
- Your application's access control logic and role-based field visibility.
- Your network topology outside Atlas (your VPC, your application servers).
- Whether your application ever accepts or stores CVV, PIN, or full PAN.
- Any Atlas product currently in beta or preview status.

The customer must run their own PCI DSS compliance program. The AOC reduces the assessment burden for the platform layer so the QSA can focus on the application layer.

---

#### **18. Is Queryable Encryption (QE) required for Atlas to be PCI DSS certified? What PCI DSS requirements does it address?**

**Answer:**
QE is not what certifies Atlas as PCI DSS compliant. The certification is based on platform-level controls: encryption at rest, TLS, network security, and MongoDB's operational security program. Atlas was PCI DSS certified before QE existed.

QE is an application-side control that the *customer* deploys in their backend service. It is complementary to, not a replacement for, the platform certification. It addresses specific requirements that go beyond what the platform layer can provide:

**Requirement 3.4 (CHD must be unreadable at rest):**
Atlas AES-256 encryption at rest satisfies this at the storage layer: an attacker who steals a disk volume cannot read the data. QE provides a stronger guarantee: the CHD field is encrypted *before the BSON document leaves the application server*, so the Atlas server never receives the plaintext value. It cannot appear in process memory, query plans, slow query logs, or any internal MongoDB tooling. This is protection even against a fully compromised Atlas account or a malicious insider at MongoDB.

**Requirement 3.6 (Key management):**
The Customer Master Key (CMK) lives in AWS KMS under the customer's exclusive control. The DEK is unwrapped only in the application process memory during an active session. MongoDB has zero access to either key. Rotating the CMK or revoking it immediately renders all QE-encrypted data inaccessible to any query, including from Atlas itself.

**Requirement 7 (Restrict access to CHD by business need):**
Atlas RBAC restricts who can connect to a database and run queries. QE adds a cryptographic boundary on top: a user with full Atlas admin credentials who queries the collection without the QE client receives only opaque ciphertext. The access control is mathematical, not policy-based, and cannot be bypassed by any administrative action inside Atlas.

**Requirement 10 (Audit trail):**
Every decryption event happens in the application layer, where it can be logged with full context: which user, which role, which case, which fields, and at what time. Atlas audit logs record the raw MongoDB operation; the application-level audit trail records the business intent behind it.

In summary: Atlas certification covers the infrastructure contract. QE covers the data contract. A complete PCI DSS posture requires both.

---

#### **19. How does the "Encrypted in Atlas" toggle in the demo prove that MongoDB cannot read the data?**

**Answer:**
The toggle demonstrates the encryption boundary by making two different calls to the same document and showing the results side by side.

**Decrypted view (normal application path):**
The Fastify backend queries Atlas using the QE-enabled MongoClient. The QE driver contacts AWS KMS to unwrap the DEK, then decrypts the encrypted fields in the application process before returning the document. The response contains readable values: `customerEmailAddress`, `customerMobilePhoneNumber`, `cardTransactionAccountReference`.

**Raw Atlas view (what MongoDB stores):**
A second backend endpoint queries the same document using a plain MongoClient with no QE configuration and no DEK. It receives the BSON exactly as Atlas stores it on disk. The encrypted fields appear as binary ciphertext. No application, no database administrator, and no MongoDB engineer can recover the plaintext from this blob without the DEK and the CMK.

The presenter talking point: "This is what Atlas sees. Not the email address, not the account reference. Just encrypted bytes. The only system that can read these fields is your backend, using your keys, in your KMS. MongoDB has zero access."

This toggle is the single most effective moment in the demo for answering the question: *"How do we know MongoDB cannot read our cardholder data?"* The answer is not a policy statement or a contractual guarantee. It is a live query result showing ciphertext in the database and plaintext in the application, with the difference being cryptographic key possession.