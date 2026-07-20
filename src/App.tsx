import { useState, useEffect } from 'react';
import { 
  Rocket, 
  Wallet, 
  Clock, 
  ShieldCheck,
  LayoutDashboard,
  TrendingUp,
  PlusCircle,
  Search,
  Users,
  Activity,
  Loader2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  setAllowed,
  isConnected,
  getAddress,
  signTransaction,
} from "@stellar/freighter-api";
import { 
  rpc, 
  Networks, 
  Keypair, 
  TransactionBuilder, 
  nativeToScVal,
  scValToNative,
  Contract,
  Account
} from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';

const FACTORY_ID = "CCWH7RZKQLSZTQ4EDJA677UOXGAHMCAHRUX2BQMDNV4WSLB3DIYYDDYT";
const DEMO_CAMPAIGN_ID = "CDEJ4YO44LZT62DZO7BMOK6WSDRDX3XCYOEGPOCJB3CKNDJ5HLKEEPNZ";
const NATIVE_TOKEN_ID = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const RPC_URL = "https://soroban-testnet.stellar.org";
const server = new rpc.Server(RPC_URL);

interface Campaign {
  id: string;
  title: string;
  description: string;
  goal: number; // in XLM
  deadline: number; // UNIX timestamp
  pledged: number; // in XLM
  status: string;
}

function App() {
  const [address, setAddress] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'campaigns' | 'create'>('dashboard');
  
  // Create Form State
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [goal, setGoal] = useState('');
  const [deadline, setDeadline] = useState('');
  
  // Pledge State map keyed by campaign ID
  const [pledgeAmounts, setPledgeAmounts] = useState<Record<string, string>>({});
  
  // Tx status
  const [txStatus, setTxStatus] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Loaded Campaigns
  const [campaigns, setCampaigns] = useState<Campaign[]>(() => {
    const saved = localStorage.getItem('fundloop_campaigns');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error(e);
      }
    }
    return [
      {
        id: "CDEJ4YO44LZT62DZO7BMOK6WSDRDX3XCYOEGPOCJB3CKNDJ5HLKEEPNZ",
        title: "FundLoop Demo Campaign",
        description: "This is an authentic demo campaign created during deployment. Live on Testnet!",
        goal: 10,
        deadline: 1800000000,
        pledged: 10,
        status: "Active"
      }
    ];
  });

  // Save campaigns to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('fundloop_campaigns', JSON.stringify(campaigns));
  }, [campaigns]);

  const fetchCampaignBlockchainState = async (campaignId: string) => {
    try {
      const contract = new Contract(campaignId);
      const dummySource = Keypair.random();
      
      // Get total pledged
      const txPledged = new TransactionBuilder(
        new Account(dummySource.publicKey(), "0"),
        {
          fee: "100000",
          networkPassphrase: Networks.TESTNET,
        }
      )
        .addOperation(contract.call("get_total_pledged"))
        .setTimeout(30)
        .build();
      
      const simPledged = await server.simulateTransaction(txPledged);
      let pledgedVal = 0;
      if (rpc.Api.isSimulationSuccess(simPledged) && simPledged.result) {
        const nativeVal = scValToNative(simPledged.result.retval);
        pledgedVal = Number(BigInt(nativeVal)) / 10000000;
      }

      // Get status
      const txStatus = new TransactionBuilder(
        new Account(dummySource.publicKey(), "0"),
        {
          fee: "100000",
          networkPassphrase: Networks.TESTNET,
        }
      )
        .addOperation(contract.call("get_status"))
        .setTimeout(30)
        .build();
        
      const simStatus = await server.simulateTransaction(txStatus);
      let statusStr = "Active";
      if (rpc.Api.isSimulationSuccess(simStatus) && simStatus.result) {
        const nativeStatus = scValToNative(simStatus.result.retval);
        statusStr = typeof nativeStatus === 'string' ? nativeStatus : (nativeStatus.name || "Active");
      }

      return { pledged: pledgedVal, status: statusStr };
    } catch (e) {
      console.error(`Failed to fetch blockchain state for ${campaignId}`, e);
      return null;
    }
  };

  const loadCampaignsFromChain = async () => {
    try {
      const contract = new Contract(FACTORY_ID);
      const dummySource = Keypair.random();
      const tx = new TransactionBuilder(
        new Account(dummySource.publicKey(), "0"),
        {
          fee: "100000",
          networkPassphrase: Networks.TESTNET,
        }
      )
        .addOperation(contract.call("list_campaigns"))
        .setTimeout(30)
        .build();
        
      const sim = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationSuccess(sim) && sim.result) {
        const scVal = sim.result.retval;
        const campaignAddresses = scValToNative(scVal) as string[];
        
        const loaded: Campaign[] = await Promise.all(
          campaignAddresses.map(async (addr) => {
            // Check if we have metadata in localStorage
            const metaSaved = localStorage.getItem(`meta_${addr}`);
            let campaignMeta = metaSaved ? JSON.parse(metaSaved) : null;
            
            if (!campaignMeta) {
              campaignMeta = {
                title: `Campaign ${addr.slice(0, 6)}...${addr.slice(-4)}`,
                description: "Soroban Crowdfunding Campaign",
                goal: 10,
                deadline: 1800000000
              };
            }

            // Fetch live state
            const liveState = await fetchCampaignBlockchainState(addr);
            return {
              id: addr,
              title: campaignMeta.title,
              description: campaignMeta.description,
              goal: campaignMeta.goal,
              deadline: campaignMeta.deadline,
              pledged: liveState ? liveState.pledged : 0,
              status: liveState ? liveState.status : "Active"
            };
          })
        );
        
        // Optimistic Merge: Keep campaigns from local storage if they aren't in the blockchain list yet
        const saved = localStorage.getItem('fundloop_campaigns');
        const localCampaigns: Campaign[] = saved ? JSON.parse(saved) : [];
        
        const merged = [...loaded];
        for (const local of localCampaigns) {
          if (local.id && !merged.some(c => c.id === local.id)) {
            merged.push(local);
          }
        }

        // Filter out duplicates and keep the hardcoded demo campaign if it's not in the returned list
        const hasDemo = merged.some(c => c.id === DEMO_CAMPAIGN_ID);
        if (!hasDemo) {
          merged.push({
            id: DEMO_CAMPAIGN_ID,
            title: "FundLoop Demo Campaign",
            description: "This is an authentic demo campaign created during deployment. Live on Testnet!",
            goal: 10,
            deadline: 1800000000,
            pledged: 10,
            status: "Active"
          });
        }

        setCampaigns(merged);
      }
    } catch (e) {
      console.error("Failed to load campaigns from Factory registry", e);
    }
  };

  const checkConnection = async () => {
    if (await isConnected()) {
      const res = await getAddress();
      if (res.address) {
        setAddress(res.address);
      }
    }
  };

  useEffect(() => {
    // Self-healing: clean up any corrupted "Unknown Campaign ID" states in localStorage
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('meta_')) {
        const addr = k.substring(5);
        if (!addr.startsWith('C') || addr.length !== 56) {
          localStorage.removeItem(k);
        }
      }
    });
    const saved = localStorage.getItem('fundloop_campaigns');
    if (saved) {
      try {
        const localCampaigns: Campaign[] = JSON.parse(saved);
        const filtered = localCampaigns.filter(c => c.id && c.id.startsWith('C') && c.id.length === 56);
        localStorage.setItem('fundloop_campaigns', JSON.stringify(filtered));
      } catch (e) {
        localStorage.removeItem('fundloop_campaigns');
      }
    }

    checkConnection();
    loadCampaignsFromChain();
  }, []);

  const handleConnect = async () => {
    setLoading(true);
    try {
      await setAllowed();
      const res = await getAddress();
      if (res.address) {
        setAddress(res.address);
      }
    } catch (e) {
      console.error(e);
      setErrorMsg("Failed to connect Freighter wallet.");
    }
    setLoading(false);
  };

  // Helper to poll tx status and extract return value
  const pollTransaction = async (hash: string): Promise<string | null> => {
    setTxStatus("Waiting for transaction status...");
    for (let i = 0; i < 15; i++) {
      const status = await server.getTransaction(hash);
      if (status.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        setTxStatus("Transaction successful!");
        try {
          if (status.returnValue) {
            const contractId = scValToNative(status.returnValue);
            if (typeof contractId === 'string' && contractId.startsWith('C') && contractId.length === 56) {
              return contractId;
            }
          }
        } catch (e: any) {
          console.error("Failed to parse return value from status.returnValue", e);
        }
        return "success";
      } else if (status.status === rpc.Api.GetTransactionStatus.FAILED) {
        setTxStatus("Transaction failed.");
        setErrorMsg("Transaction execution failed on the ledger.");
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    setTxStatus("Transaction timeout.");
    return null;
  };

  const handleDeployCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) {
      setErrorMsg("Please connect your wallet first!");
      return;
    }
    if (!title || !description || !goal || !deadline) {
      setErrorMsg("Please fill out all fields.");
      return;
    }

    const parsedGoal = parseFloat(goal);
    if (isNaN(parsedGoal) || parsedGoal <= 0) {
      setErrorMsg("Goal must be greater than 0.");
      return;
    }

    const parsedDeadline = Math.floor(new Date(deadline).getTime() / 1000);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (isNaN(parsedDeadline) || parsedDeadline <= nowSeconds) {
      setErrorMsg("Deadline must be in the future.");
      return;
    }

    setLoading(true);
    setTxStatus("Preparing transaction...");
    setTxHash('');
    setErrorMsg('');

    try {
      // Convert XLM to Stroops (i128)
      const goalStroops = BigInt(parseFloat(goal) * 10000000);
      const deadlineUnix = BigInt(parsedDeadline);

      // Generate a random 32-byte salt hex
      const saltHex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const saltBytes = Buffer.from(saltHex, "hex");

      // Load source account details
      const account = await server.getAccount(address);

      const contract = new Contract(FACTORY_ID);
      
      // Build transaction
      const tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call(
            "create_campaign",
            nativeToScVal(address, { type: "address" }), // creator
            nativeToScVal(goalStroops, { type: "i128" }), // goal
            nativeToScVal(deadlineUnix, { type: "u64" }), // deadline
            nativeToScVal(title), // title
            nativeToScVal(description), // description
            nativeToScVal(NATIVE_TOKEN_ID, { type: "address" }), // token
            nativeToScVal(saltBytes, { type: "bytes" }) // salt
          )
        )
        .setTimeout(30)
        .build();

      setTxStatus("Simulating transaction footprint...");
      const preparedTx = await server.prepareTransaction(tx);

      setTxStatus("Awaiting Freighter signature...");
      const signRes = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });
      const signedXdr = signRes.signedTxXdr;

      setTxStatus("Submitting to Stellar Testnet...");
      const submitResponse = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET)
      );

      if (submitResponse.status === "PENDING") {
        setTxHash(submitResponse.hash);
        const createdCampaignAddress = await pollTransaction(submitResponse.hash);
        if (createdCampaignAddress && createdCampaignAddress !== "success") {
          // Save specific metadata persistently so we can link it with list_campaigns on reload
          localStorage.setItem(`meta_${createdCampaignAddress}`, JSON.stringify({
            title,
            description,
            goal: parseFloat(goal),
            deadline: parsedDeadline,
          }));

          // Add to local state list
          const newCampaign: Campaign = {
            id: createdCampaignAddress,
            title,
            description,
            goal: parseFloat(goal),
            deadline: parsedDeadline,
            pledged: 0,
            status: "Active"
          };
          setCampaigns(prev => [newCampaign, ...prev]);
          setTitle('');
          setDescription('');
          setGoal('');
          setDeadline('');
          setActiveTab('campaigns');
        } else {
          setErrorMsg("Failed to retrieve the new campaign contract address from the deployment transaction.");
        }
      } else {
        setErrorMsg("Failed to submit transaction: " + JSON.stringify(submitResponse));
      }

    } catch (e: any) {
      console.error("Full deployment error:", e);
      let msg = e.message || "An error occurred during deployment.";
      if (e.response && e.response.data) {
        msg += " RPC Details: " + JSON.stringify(e.response.data);
      } else if (e.raw) {
        msg += " Raw Details: " + JSON.stringify(e.raw);
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handlePledge = async (campaignId: string, amount: string) => {
    if (!address) {
      setErrorMsg("Please connect your wallet first!");
      return;
    }
    setLoading(true);
    setTxStatus("Preparing pledge transaction...");
    setTxHash('');
    setErrorMsg('');

    try {
      const pledgeStroops = BigInt(parseFloat(amount) * 10000000);
      const account = await server.getAccount(address);
      const contract = new Contract(campaignId);

      const tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call(
            "pledge",
            nativeToScVal(address, { type: "address" }), // contributor
            nativeToScVal(pledgeStroops, { type: "i128" }) // amount
          )
        )
        .setTimeout(30)
        .build();

      setTxStatus("Simulating pledge...");
      const preparedTx = await server.prepareTransaction(tx);

      setTxStatus("Awaiting Freighter signature...");
      const signRes = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });
      const signedXdr = signRes.signedTxXdr;

      setTxStatus("Submitting pledge transaction...");
      const submitResponse = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET)
      );

      if (submitResponse.status === "PENDING") {
        setTxHash(submitResponse.hash);
        const success = await pollTransaction(submitResponse.hash);
        if (success) {
          // Update local state amount pledged
          setCampaigns(prev => prev.map(c => {
            if (c.id === campaignId) {
              return { ...c, pledged: c.pledged + parseFloat(amount) };
            }
            return c;
          }));
        }
      } else {
        setErrorMsg("Failed to submit transaction: " + JSON.stringify(submitResponse));
      }

    } catch (e: any) {
      console.error("Full pledge error:", e);
      let msg = e.message || "An error occurred during pledge.";
      if (e.response && e.response.data) {
        msg += " RPC Details: " + JSON.stringify(e.response.data);
      } else if (e.raw) {
        msg += " Raw Details: " + JSON.stringify(e.raw);
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async (campaignId: string) => {
    if (!address) {
      setErrorMsg("Please connect your wallet first!");
      return;
    }
    setLoading(true);
    setTxStatus("Preparing withdrawal...");
    setTxHash('');
    setErrorMsg('');

    try {
      const account = await server.getAccount(address);
      const contract = new Contract(campaignId);

      const tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call(
            "withdraw",
            nativeToScVal(address, { type: "address" }) // creator
          )
        )
        .setTimeout(30)
        .build();

      setTxStatus("Simulating withdrawal...");
      const preparedTx = await server.prepareTransaction(tx);

      setTxStatus("Awaiting signature...");
      const signRes = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });
      const signedXdr = signRes.signedTxXdr;

      setTxStatus("Submitting withdrawal...");
      const submitResponse = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET)
      );

      if (submitResponse.status === "PENDING") {
        setTxHash(submitResponse.hash);
        const success = await pollTransaction(submitResponse.hash);
        if (success) {
          loadCampaignsFromChain();
        }
      }
    } catch (e: any) {
      console.error("Full withdrawal error:", e);
      let msg = e.message || "An error occurred during withdrawal.";
      if (e.response && e.response.data) {
        msg += " RPC Details: " + JSON.stringify(e.response.data);
      } else if (e.raw) {
        msg += " Raw Details: " + JSON.stringify(e.raw);
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleClaimRefund = async (campaignId: string) => {
    if (!address) {
      setErrorMsg("Please connect your wallet first!");
      return;
    }
    setLoading(true);
    setTxStatus("Preparing refund claim...");
    setTxHash('');
    setErrorMsg('');

    try {
      const account = await server.getAccount(address);
      const contract = new Contract(campaignId);

      const tx = new TransactionBuilder(account, {
        fee: "100000",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          contract.call(
            "claim_refund",
            nativeToScVal(address, { type: "address" }) // contributor
          )
        )
        .setTimeout(30)
        .build();

      setTxStatus("Simulating refund...");
      const preparedTx = await server.prepareTransaction(tx);

      setTxStatus("Awaiting signature...");
      const signRes = await signTransaction(preparedTx.toXDR(), {
        networkPassphrase: Networks.TESTNET,
      });
      const signedXdr = signRes.signedTxXdr;

      setTxStatus("Submitting refund...");
      const submitResponse = await server.sendTransaction(
        TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET)
      );

      if (submitResponse.status === "PENDING") {
        setTxHash(submitResponse.hash);
        const success = await pollTransaction(submitResponse.hash);
        if (success) {
          loadCampaignsFromChain();
        }
      }
    } catch (e: any) {
      console.error("Full refund error:", e);
      let msg = e.message || "An error occurred during refund.";
      if (e.response && e.response.data) {
        msg += " RPC Details: " + JSON.stringify(e.response.data);
      } else if (e.raw) {
        msg += " Raw Details: " + JSON.stringify(e.raw);
      }
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-layout">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <a href="#" className="logo">
          <Rocket className="logo-icon" size={28} />
          FundLoop
        </a>
        
        <nav className="nav-menu">
          <button 
            className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={20} />
            Overview
          </button>
          <button 
            className={`nav-item ${activeTab === 'campaigns' ? 'active' : ''}`}
            onClick={() => setActiveTab('campaigns')}
          >
            <TrendingUp size={20} />
            Explore Campaigns
          </button>
          <button 
            className={`nav-item ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => setActiveTab('create')}
          >
            <PlusCircle size={20} />
            Create Campaign
          </button>
        </nav>

        <div style={{ marginTop: 'auto', padding: '1rem', background: 'hsl(var(--bg-card))', borderRadius: '1rem', border: '1px solid hsl(var(--border))' }}>
          <div style={{ fontSize: '0.85rem', color: 'hsl(var(--text-muted))', marginBottom: '0.5rem' }}>Factory Contract</div>
          <div style={{ fontSize: '0.75rem', wordBreak: 'break-all', fontFamily: 'monospace', color: 'hsl(var(--primary))' }}>
            {FACTORY_ID}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        <header className="topbar">
          <div className="search-bar">
            <Search size={18} style={{ color: 'hsl(var(--text-muted))' }} />
            <input type="text" placeholder="Search campaigns, creators..." />
          </div>

          <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
            {address ? (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div className="badge badge-success" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem' }}>
                  <Wallet size={16} />
                  {address.slice(0, 4)}...{address.slice(-4)}
                </div>
                <button 
                  className="btn btn-outline" 
                  style={{ padding: '0.65rem 1.25rem', fontSize: '0.9rem', borderColor: 'hsla(350, 89%, 60%, 0.4)', color: 'hsl(350, 89%, 70%)' }} 
                  onClick={() => setAddress('')}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button className="btn btn-primary" onClick={handleConnect} disabled={loading}>
                <Wallet size={18} />
                {loading ? 'Connecting...' : 'Connect Freighter'}
              </button>
            )}
          </div>
        </header>

        {/* Global Loading / Status Messages */}
        {(loading || txStatus || errorMsg) && (
          <div className="card animate-fade-in" style={{ marginBottom: '2rem', borderColor: errorMsg ? 'hsl(var(--error))' : 'hsl(var(--primary))' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              {loading && <Loader2 className="animate-spin" size={24} style={{ color: 'hsl(var(--primary))' }} />}
              {!loading && errorMsg && <AlertCircle size={24} style={{ color: 'hsl(var(--error))' }} />}
              {!loading && !errorMsg && <CheckCircle2 size={24} style={{ color: 'hsl(var(--success))' }} />}
              
              <div style={{ flexGrow: 1 }}>
                {errorMsg ? (
                  <p style={{ color: 'hsl(var(--error))', fontWeight: 600 }}>{errorMsg}</p>
                ) : (
                  <p style={{ fontWeight: 600 }}>{txStatus}</p>
                )}
                {txHash && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                    Tx Hash: <a href={`https://stellar.expert/explorer/testnet/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ color: 'hsl(var(--primary))', wordBreak: 'break-all' }}>{txHash}</a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'dashboard' && (
          <div className="animate-fade-in">
            <h1 style={{ marginBottom: '2rem' }}>Welcome to FundLoop</h1>
            
            <div className="overview-grid">
              <div className="overview-card">
                <div className="icon-wrapper"><Activity size={24} /></div>
                <div className="overview-value">12.5k XLM</div>
                <div className="overview-label">Total Volume Funded</div>
              </div>
              <div className="overview-card">
                <div className="icon-wrapper"><Rocket size={24} /></div>
                <div className="overview-value">42</div>
                <div className="overview-label">Active Campaigns</div>
              </div>
              <div className="overview-card">
                <div className="icon-wrapper"><Users size={24} /></div>
                <div className="overview-value">1,204</div>
                <div className="overview-label">Unique Backers</div>
              </div>
            </div>

            <h2>Featured Campaign</h2>
            <div className="card" style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'row', gap: '3rem', alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                  <span className="badge badge-active">Live on Testnet</span>
                  <span className="badge badge-primary"><ShieldCheck size={14} /> Verified</span>
                </div>
                <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>FundLoop Demo Campaign</h2>
                <p style={{ fontSize: '1.1rem', marginBottom: '2rem' }}>
                  This is the authentic demo campaign created during the production deployment of FundLoop's smart contracts. Back this project natively using XLM on the Stellar network.
                </p>
                <button className="btn btn-primary" onClick={() => setActiveTab('campaigns')}>
                  View Details & Pledge <TrendingUp size={18} />
                </button>
              </div>
              <div style={{ flex: 1, background: 'hsla(var(--bg-dark), 0.5)', padding: '2rem', borderRadius: '1rem', border: '1px solid hsl(var(--border))' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600 }}>Funding Progress</span>
                  <span style={{ color: 'hsl(var(--primary))', fontWeight: 700 }}>25%</span>
                </div>
                <div className="progress-bg" style={{ height: '12px', marginBottom: '2rem' }}>
                  <div className="progress-fill" style={{ width: '25%' }}></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Pledged</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>10 XLM</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: 'hsl(var(--text-muted))', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Goal</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>10 XLM</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'campaigns' && (
          <div className="animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <h2>Explore Campaigns</h2>
            </div>

            <div className="campaigns-grid">
              {campaigns.map((c, idx) => {
                const percent = Math.min(100, Math.round((c.pledged / c.goal) * 100));
                return (
                  <div className="card" key={idx}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                      <span className="badge badge-active">{c.status}</span>
                      <span style={{ color: 'hsl(var(--text-muted))', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Clock size={14} /> {c.deadline.toString()}
                      </span>
                    </div>
                    
                    <h3 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>{c.title}</h3>
                    <p style={{ marginBottom: '1.5rem', fontSize: '0.95rem', flexGrow: 1 }}>
                      {c.description}
                    </p>
                    
                    <div className="progress-bg">
                      <div className="progress-fill" style={{ width: `${percent}%` }}></div>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                      <div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>{c.pledged} XLM</div>
                        <div style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>Pledged</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>{c.goal} XLM</div>
                        <div style={{ fontSize: '0.8rem', color: 'hsl(var(--text-muted))', textTransform: 'uppercase' }}>Goal</div>
                      </div>
                    </div>
                    
                    <div style={{ borderTop: '1px solid hsl(var(--border))', paddingTop: '1.5rem' }}>
                      {c.status === 'Active' && (
                        <>
                          <label className="form-label" style={{ fontSize: '0.9rem' }}>Pledge Amount (XLM)</label>
                          <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <input 
                              type="number" 
                              className="form-input" 
                              style={{ padding: '0.6rem 1rem' }}
                              value={pledgeAmounts[c.id] || '10'}
                              onChange={(e) => {
                                const val = e.target.value;
                                setPledgeAmounts(prev => ({ ...prev, [c.id]: val }));
                              }}
                            />
                            <button 
                              className="btn btn-primary" 
                              onClick={() => handlePledge(c.id, pledgeAmounts[c.id] || '10')} 
                              style={{ whiteSpace: 'nowrap', padding: '0.6rem 1.25rem' }}
                              disabled={loading}
                            >
                              Pledge
                            </button>
                          </div>
                        </>
                      )}

                      {c.status === 'GoalMet' && (
                        <button 
                          className="btn btn-primary" 
                          style={{ width: '100%', padding: '0.75rem' }}
                          onClick={() => handleWithdraw(c.id)}
                          disabled={loading}
                        >
                          Withdraw Funds (Creator Only)
                        </button>
                      )}

                      {c.status === 'Failed' && (
                        <button 
                          className="btn btn-outline" 
                          style={{ width: '100%', padding: '0.75rem', borderColor: 'hsl(var(--error))', color: 'hsl(var(--error))' }}
                          onClick={() => handleClaimRefund(c.id)}
                          disabled={loading}
                        >
                          Claim Refund
                        </button>
                      )}

                      {c.status === 'Withdrawn' && (
                        <div style={{ textAlign: 'center', color: 'hsl(var(--success))', fontWeight: 600, padding: '0.5rem' }}>
                          ✓ Funds successfully withdrawn
                        </div>
                      )}

                      <div style={{ fontSize: '0.7rem', color: 'hsl(var(--text-muted))', marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center', wordBreak: 'break-all' }}>
                        <ShieldCheck size={12} style={{ flexShrink: 0 }} /> {c.id}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'create' && (
          <div className="animate-fade-in" style={{ maxWidth: '800px', margin: '0 auto', width: '100%' }}>
            <div style={{ marginBottom: '2rem' }}>
              <h2>Launch a Campaign</h2>
              <p>Deploy a new decentralized fundraising contract directly to the Stellar network.</p>
            </div>

            <form className="card" onSubmit={handleDeployCampaign}>
              <div className="form-group">
                <label className="form-label">Campaign Title</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. Next-Gen Space Explorer" 
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={loading}
                />
              </div>
              
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea 
                  className="form-input" 
                  rows={5} 
                  placeholder="What are you building?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={loading}
                ></textarea>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div className="form-group">
                  <label className="form-label">Funding Goal (XLM)</label>
                  <input 
                    type="number" 
                    className="form-input" 
                    placeholder="e.g. 10" 
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="deadline-picker">Deadline Date</label>
                  <input 
                    id="deadline-picker"
                    type="datetime-local" 
                    className="form-input" 
                    value={deadline}
                    onChange={(e) => setDeadline(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
              
              <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid hsl(var(--border))' }}>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }} disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />
                      Launching...
                    </>
                  ) : (
                    <>
                      <Rocket size={20} />
                      Launch Campaign
                    </>
                  )}
                </button>
                <p style={{ textAlign: 'center', fontSize: '0.85rem', marginTop: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={14} /> Factory: {FACTORY_ID.slice(0, 8)}...{FACTORY_ID.slice(-8)}
                </p>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  )
}

export default App;
