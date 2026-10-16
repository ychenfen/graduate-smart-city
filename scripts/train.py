"""初始化模拟数据并训练默认模型：python scripts/train.py [--n 160] [--force]"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from smartmix import feedback  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--n", type=int, default=160, help="模拟室内试验样本数（小样本起步）")
ap.add_argument("--force", action="store_true", help="重新生成数据")
a = ap.parse_args()
df = feedback.init_store(n=a.n, force=a.force)
m = feedback.retrain()
print(f"训练完成：样本 {m.meta['n_train']} 条，模型版本 v{m.meta['version']}，模式 {m.mode}")
