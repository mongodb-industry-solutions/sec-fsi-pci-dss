## **Architecture Reference Document for PSP Systems**

### **1. Event-Driven Architecture (EDA)**  
The entire PSP system is to be built and operated based on an Event-Driven Architecture. This approach ensures efficient processing of business flows asynchronously, with the **Event Bus** serving as the core component responsible for managing the sequence of events.

#### **Key Concepts:**  
1. **Event Bus Core:**  
   A centralized component that emits and manages events, facilitating business processes. Each business process is represented as a sequence of events, which the system processes asynchronously.

2. **Business Process Examples:**  
   - **Payments:** API Payment, Redirection Payment, Payment Link.  
   - **User Validation:** Know Your Customer (KYC).  
   - **Merchant Validation:** Know Your Business (KYB).  
   - **Investigative Case:** Fraud analysis and merchant investigations.

3. **Process Definition:**  
   - **Sequence of Events:** Each business process defines a clear event sequence. The PSP core must use the Event Bus to emit events with the correct payloads at the appropriate steps of the process, ensuring proper handling by external or internal systems.  
   - **Process Identifiers:** Each business process must define a unique identifier (e.g., transaction ID, case reference) to track and manage all associated events. This facilitates system auditing, making it possible to trace the lifecycle of processes and responses.

---

### **2. Hexagonal Architecture**  
To ensure flexibility and scalability, the PSP system adopts a **Hexagonal Architecture**. This design allows seamless interaction between the core system and external modules or subsystems.

#### **Key Design Principles:**  
1. **Provider Categories:**  
   Integration is divided into the following distinct **categories**, which play specific roles within different business workflows:
   - Fraud Detection System (FDS)  
   - Human Resource Processes (HRP)  
   - Anti-Money Laundering (AML)  
   - Know Your Customer (KYC)  
   - Know Your Business (KYB)  
   - Card Issuer  
   - Credit Bureau  
   - Card Authorization  

2. **Provider Groups:**  
   - Each category defines a **Provider Group**, which is responsible for managing multiple providers with a common business goal.  
   - Providers within the same group respond to the same events but may offer different strategies for execution. For instance:
     - In the **Card Issuer** group, multiple providers may handle card validation events (e.g., CVV, PIN verification).  
     - The execution strategy may focus on default provider selection or fallback mechanisms, where the next provider in the group handles the request if the first one fails.

3. **Providers:**  
   - A **Provider** is equivalent to a **Port** in the Hexagonal Architecture. It defines the **inbound** and **outbound** behaviors for specific events it handles.  
   - Providers interact directly with external systems or modules for event processing.  

4. **Provider Event Configurations:**  
   - **Outbound Configuration:**  
     - Defines how outgoing attributes are mapped between the PSP system and external systems. For example:
       - If the PSP emits an event with a field `cvv`, but the external system expects `cvvData`, mapping ensures compatibility by transforming `cvv` into `cvvData`.  
       - Similar mapping applies to headers (e.g., transforming `authorization` into `X-Authorization`).  
     - Providers must configure security features like API Keys, HTTP action methods (POST, GET, etc.), retries, timeout settings, etc.  
     - Provider-specific configurations (e.g., security and data formats) must align with their category.  

   - **Inbound Configuration:**  
     - Defines how responses from external systems to specific events are processed via inbound callbacks.  
     - Mapping of inbound attributes ensures the system properly interprets external data.  
     - Security measures (e.g., authenticity checks, anti-spoofing techniques) must verify that the response comes from legitimate external systems.

5. **External Systems/Adapters:**  
   - External systems (referred to as **vendors**) act as adapters that implement the PSP-defined Ports.  
   - These systems must process requests and provide responses via the defined callback endpoints.

6. **Modules:**  
   - **Build-in Modules:**  
     - Internal implementations that provide basic functionality for providers without creating system dependencies.  
     - Modules act as adapters and should be configured via providers.  
     - Example: A "build-in card validator" module that supports CVV validation but can be easily replaced by external card issuer providers.  

   - **Configuration & Response Handling:**  
     - Modules must implement the inbound/outbound requirements of the provider for specific events.  
     - Callback URLs and configurations for modules are dynamic and should support easy replacement by external systems.

#### **Directory Structure:**  
- All **Provider Groups** must reside in:  
  `backend/src/modules`.  
- All **Build-in Modules** (vendors/internal adapters) must reside in:  
  `backend/src/vendors`.  
This distinction cleanly separates the **PSP core** from replaceable subsystems.

---

### **3. Pattern and System Design Rules**  

1. **Event Bus Implementation:**  
   - The Event Bus should provide an **in-memory MongoDB-based implementation** by default for simplicity and local deployment.  
   - Scalability through pluggable engines (e.g., RabbitMQ, Kafka, etc.) must be available via a **Strategy Pattern**. Configuration should allow easy switching between engines without requiring code changes.  
   - The PSP core and Provider Groups must interface with the global Event Bus without direct dependence on the underlying technology.

2. **Programming Paradigm:**  
   - The system follows **Object-Oriented Programming (OOP)** principles, utilizing interfaces and strong type definitions to maintain clarity and ensure extensibility.  
   - A strict **maximum inheritance depth of 3 levels** must be adhered to, avoiding anti-patterns. Functional programming may only be applied for extremely simple, localized tasks.

3. **PCI DSS Compliance:**  
   - All data flows and system interactions must strictly adhere to PCI DSS standards to ensure the security of sensitive payment information.

4. **Data Architecture Principles:**  
   - The system must follow the **BIAN (Banking Industry Architecture Network)** standards for data structure and information flow.  

---

### **4. Development Best Practices**  

1. **KISS Principle:**  
   - Keep code simple and avoid unnecessary complexity.  
   - Minimize duplication of code, variables, constants, models, interfaces, and collections.  
   - Reuse components whenever possible to simplify maintenance and scalability.

2. **Commenting Standards:**  
   - Use **JSDoc** format for comments.  
   - All documentation must be concise, written in English, and limited to 2 lines per comment. Avoid excessive commenting and refrain from including progress details in comments.

3. **Resource Efficiency:**  
   - Optimize resource usage for maximum performance.  
   - Prioritize system UX/UI responsiveness by minimizing latency and computational overhead.

