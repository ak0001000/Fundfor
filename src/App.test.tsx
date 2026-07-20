import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

// Mock Freighter API
vi.mock('@stellar/freighter-api', () => ({
  isConnected: vi.fn(() => Promise.resolve({ isConnected: false })),
  getAddress: vi.fn(() => Promise.resolve({ address: '' })),
  setAllowed: vi.fn(() => Promise.resolve(true)),
  signTransaction: vi.fn(),
}));

// Mock Stellar SDK
vi.mock('@stellar/stellar-sdk', () => {
  class MockServer {
    getAccount = vi.fn();
    getTransaction = vi.fn();
    sendTransaction = vi.fn();
    simulateTransaction = vi.fn(() => Promise.resolve({
      result: { retval: [] }
    }));
  }
  class MockKeypair {
    static random() {
      return {
        publicKey: () => 'GDUMMYKEY...',
      };
    }
  }
  class MockAccount {
    accountId: string;
    sequence: string;
    constructor(accountId: string, sequence: string) {
      this.accountId = accountId;
      this.sequence = sequence;
    }
  }
  class MockTransactionBuilder {
    addOperation = vi.fn().mockReturnThis();
    setTimeout = vi.fn().mockReturnThis();
    build = vi.fn(() => ({
      toXDR: () => 'dummy_xdr',
    }));
  }
  class MockContract {
    address: string;
    constructor(address: string) {
      this.address = address;
    }
    call = vi.fn();
  }
  return {
    Contract: MockContract,
    rpc: {
      Server: MockServer,
      Api: {
        isSimulationSuccess: () => false,
        GetTransactionStatus: {
          SUCCESS: 'SUCCESS',
          FAILED: 'FAILED',
        },
      },
    },
    TransactionBuilder: MockTransactionBuilder,
    Networks: { TESTNET: 'TESTNET' },
    nativeToScVal: vi.fn(),
    scValToNative: vi.fn(() => []),
    Keypair: MockKeypair,
    Account: MockAccount,
  };
});

describe('FundLoop Frontend Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders campaign list correctly', async () => {
    render(<App />);
    
    // Switch to Explore Campaigns tab
    const exploreTab = await screen.findByText('Explore Campaigns');
    fireEvent.click(exploreTab);

    // Check if the default demo campaign is rendered
    expect(screen.getAllByText('Explore Campaigns')[0]).toBeInTheDocument();
    expect(screen.getByText('FundLoop Demo Campaign')).toBeInTheDocument();
  });

  it('pledge button requires wallet connection (shows connect first alert or similar)', async () => {
    render(<App />);
    
    // Switch to Explore tab
    const exploreTab = await screen.findByText('Explore Campaigns');
    fireEvent.click(exploreTab);

    // Click pledge
    const pledgeButton = await screen.findByRole('button', { name: 'Pledge' });
    fireEvent.click(pledgeButton);

    // Expect error message to connect wallet
    const errorAlert = await screen.findByText('Please connect your wallet first!');
    expect(errorAlert).toBeInTheDocument();
  });

  it('validates form goal and deadline inputs', async () => {
    // Mock wallet connected state on mount
    const freighter = await import('@stellar/freighter-api');
    vi.mocked(freighter.isConnected).mockResolvedValue({ isConnected: true });
    vi.mocked(freighter.getAddress).mockResolvedValue({ address: 'GCFVRGYFGHCPMR3IZ33IQZWBNCTMCZIJOQXMR55ACINGNWPYA6TLWSM2' });

    render(<App />);

    // Wait for wallet to connect automatically on mount
    await screen.findByText('GCFV...WSM2');

    // Switch to Create Campaign tab
    const createTab = await screen.findByText('Create Campaign');
    fireEvent.click(createTab);

    const titleInput = await screen.findByPlaceholderText('e.g. Next-Gen Space Explorer');
    const descInput = await screen.findByPlaceholderText('What are you building?');
    const goalInput = await screen.findByPlaceholderText('e.g. 10');
    const deadlineInput = await screen.findByLabelText('Deadline Date');
    const submitButton = await screen.findByRole('button', { name: 'Launch Campaign' });

    // Fill details with invalid goal (0)
    fireEvent.change(titleInput, { target: { value: 'My Project' } });
    fireEvent.change(descInput, { target: { value: 'Cool description' } });
    fireEvent.change(goalInput, { target: { value: '0' } });
    fireEvent.change(deadlineInput, { target: { value: '2027-01-01T00:00' } });
    fireEvent.click(submitButton);

    const goalError = await screen.findByText('Goal must be greater than 0.');
    expect(goalError).toBeInTheDocument();

    // Fill details with invalid deadline (past date)
    fireEvent.change(goalInput, { target: { value: '100' } });
    fireEvent.change(deadlineInput, { target: { value: '2020-01-01T00:00' } }); // way in the past
    fireEvent.click(submitButton);

    const deadlineError = await screen.findByText('Deadline must be in the future.');
    expect(deadlineError).toBeInTheDocument();
  });
});
