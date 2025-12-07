/**
 * PythonMLRuntime - Runtime manager for Python ML/Data Science workloads
 *
 * Optimized for Apple Silicon (M1/M2/M3/M4) with:
 * - Pre-installed ML packages (numpy, pandas, scikit-learn)
 * - MLX support (Apple's ML framework)
 * - Optimized BLAS/LAPACK for ARM64
 */

import { PythonRuntime } from './PythonRuntime.js';
import type {
  ExecutionContext,
  ExecutionResult,
} from '../types/index.js';
import type { Container } from '../docker/Container.js';

// ML-specific execution options
export interface MLExecutionOptions {
  // Memory limit for ML workloads (default: 2GB)
  memoryLimit?: string;
  // Enable verbose output for debugging
  verbose?: boolean;
  // Seed for reproducibility
  seed?: number;
}

// ML execution result with additional metrics
export interface MLExecutionResult extends ExecutionResult {
  metrics?: {
    peakMemoryMB?: number;
    modelLoadTime?: number;
    inferenceTime?: number;
  };
}

export class PythonMLRuntime extends PythonRuntime {
  // ML image path
  public readonly mlImage = 'mcp-sandbox-python-ml:latest';

  /**
   * Get the appropriate image (ML or standard)
   */
  public getImage(useML: boolean = true): string {
    return useML ? this.mlImage : this.defaultImage;
  }

  /**
   * Execute ML code with additional options
   */
  public async executeML(
    code: string,
    context: ExecutionContext,
    options: MLExecutionOptions = {}
  ): Promise<MLExecutionResult> {
    // Add reproducibility setup if seed provided
    let setupCode = '';
    if (options.seed !== undefined) {
      setupCode = `
import random
import numpy as np
random.seed(${options.seed})
np.random.seed(${options.seed})
try:
    import torch
    torch.manual_seed(${options.seed})
except ImportError:
    pass
`;
    }

    // Add verbose logging if requested
    if (options.verbose) {
      setupCode += `
import logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
`;
    }

    // Combine setup with user code
    const fullCode = setupCode + '\n' + code;

    // Execute using parent class
    const result = await this.execute(fullCode, context);

    // Parse metrics from stderr if available
    const metrics = this.parseMetrics(result.stderr);

    return {
      ...result,
      metrics,
    };
  }

  /**
   * Build ML-optimized Dockerfile
   */
  public buildDockerfile(_packages?: string[]): string {
    return `
FROM python:3.11-slim

# Install system dependencies for ML workloads
RUN apt-get update && apt-get install -y --no-install-recommends \\
    build-essential \\
    gcc \\
    g++ \\
    gfortran \\
    libopenblas-dev \\
    liblapack-dev \\
    pkg-config \\
    curl \\
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1000 sandbox && \\
    useradd -u 1000 -g sandbox -m sandbox

# Create workspace
RUN mkdir -p /workspace && chown sandbox:sandbox /workspace

# Install ML packages
RUN pip install --no-cache-dir --upgrade pip && \\
    pip install --no-cache-dir \\
    numpy \\
    pandas \\
    scipy \\
    scikit-learn \\
    matplotlib \\
    seaborn \\
    pillow \\
    tqdm \\
    rich \\
    joblib

# Install PyTorch (CPU version for Docker)
RUN pip install --no-cache-dir \\
    torch --index-url https://download.pytorch.org/whl/cpu

# Install MLX (works on ARM64, falls back to CPU in Docker)
RUN pip install --no-cache-dir mlx || echo "MLX not available on this platform"

# Install transformers and datasets (HuggingFace)
RUN pip install --no-cache-dir \\
    transformers \\
    datasets \\
    tokenizers

# Set environment
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV OMP_NUM_THREADS=4
ENV MKL_NUM_THREADS=4

WORKDIR /workspace
USER sandbox

CMD ["python"]
`;
  }

  /**
   * Install ML-specific packages
   */
  public async installMLPackages(
    packages: string[],
    container: Container,
    useCuda: boolean = false
  ): Promise<void> {
    // Validate ML packages
    const validPackages = this.validateMLPackages(packages);

    // Add CUDA index if needed (not relevant for Mac, but for completeness)
    const extraIndex = useCuda
      ? '--extra-index-url https://download.pytorch.org/whl/cu121'
      : '--extra-index-url https://download.pytorch.org/whl/cpu';

    await container.exec([
      'pip', 'install', '--no-cache-dir',
      extraIndex,
      ...validPackages,
    ]);
  }

  /**
   * Validate ML package names
   */
  private validateMLPackages(packages: string[]): string[] {
    const ALLOWED_ML_PACKAGES = [
      'numpy', 'pandas', 'scipy', 'scikit-learn', 'sklearn',
      'matplotlib', 'seaborn', 'plotly',
      'torch', 'torchvision', 'torchaudio',
      'tensorflow', 'keras',
      'mlx', 'mlx-lm',
      'transformers', 'datasets', 'tokenizers', 'huggingface-hub',
      'pillow', 'opencv-python', 'opencv-python-headless',
      'xgboost', 'lightgbm', 'catboost',
      'statsmodels', 'prophet',
      'tqdm', 'rich', 'joblib',
      'requests', 'aiohttp',
    ];

    return packages.filter(pkg => {
      const baseName = pkg.split('==')[0].split('>=')[0].split('<=')[0].toLowerCase();
      return ALLOWED_ML_PACKAGES.includes(baseName);
    });
  }

  /**
   * Parse metrics from execution output
   */
  private parseMetrics(output: string): MLExecutionResult['metrics'] {
    const metrics: MLExecutionResult['metrics'] = {};

    // Try to parse memory usage
    const memMatch = output.match(/Peak memory: ([\d.]+) MB/);
    if (memMatch) {
      metrics.peakMemoryMB = parseFloat(memMatch[1]);
    }

    // Try to parse model load time
    const loadMatch = output.match(/Model load time: ([\d.]+)s/);
    if (loadMatch) {
      metrics.modelLoadTime = parseFloat(loadMatch[1]) * 1000;
    }

    // Try to parse inference time
    const inferMatch = output.match(/Inference time: ([\d.]+)s/);
    if (inferMatch) {
      metrics.inferenceTime = parseFloat(inferMatch[1]) * 1000;
    }

    return Object.keys(metrics).length > 0 ? metrics : undefined;
  }

  /**
   * Get quick start code snippets for ML tasks
   */
  public static getQuickStartSnippets(): Record<string, string> {
    return {
      'numpy-basics': `
import numpy as np

# Create arrays
arr = np.array([1, 2, 3, 4, 5])
matrix = np.random.randn(3, 3)

print("Array:", arr)
print("Matrix shape:", matrix.shape)
print("Mean:", matrix.mean())
`,
      'pandas-basics': `
import pandas as pd
import numpy as np

# Create DataFrame
df = pd.DataFrame({
    'A': np.random.randn(5),
    'B': np.random.randn(5),
    'C': ['a', 'b', 'c', 'd', 'e']
})

print(df.describe())
`,
      'sklearn-classification': `
from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score

# Load data
iris = load_iris()
X_train, X_test, y_train, y_test = train_test_split(
    iris.data, iris.target, test_size=0.2, random_state=42
)

# Train model
clf = RandomForestClassifier(n_estimators=100, random_state=42)
clf.fit(X_train, y_train)

# Evaluate
predictions = clf.predict(X_test)
accuracy = accuracy_score(y_test, predictions)
print(f"Accuracy: {accuracy:.2%}")
`,
      'pytorch-basics': `
import torch

# Create tensors
x = torch.randn(3, 3)
y = torch.randn(3, 3)

# Matrix operations
z = torch.matmul(x, y)

print("Device:", x.device)
print("Shape:", z.shape)
print("Result:\\n", z)
`,
      'mlx-basics': `
try:
    import mlx.core as mx

    # Create arrays
    x = mx.array([1, 2, 3, 4, 5])
    y = mx.random.normal((3, 3))

    print("MLX Array:", x)
    print("Random matrix shape:", y.shape)
except ImportError:
    print("MLX not available (requires Apple Silicon)")
`,
    };
  }
}
