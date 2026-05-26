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