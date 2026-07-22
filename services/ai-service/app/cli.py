import argparse

from app.config import get_settings
from app.data_generator import generate_dataset
from app.model import ModelBundle
from app.training import train_and_package


def main() -> None:
    parser = argparse.ArgumentParser(description="FraudCell deterministic AI lifecycle")
    parser.add_argument("command", choices=("generate", "train", "ensure-model"))
    parser.add_argument("--rows", type=int, default=12_000)
    arguments = parser.parse_args()
    settings = get_settings()
    if arguments.command == "generate" or not settings.synthetic_data_path.exists():
        generate_dataset(
            settings.synthetic_data_path, rows=arguments.rows, seed=settings.model_seed
        )
    if arguments.command in {"train", "ensure-model"}:
        if (
            arguments.command == "ensure-model"
            and settings.model_artifact_path.exists()
            and settings.model_manifest_path.exists()
        ):
            bundle = ModelBundle(settings.model_artifact_path, settings.model_manifest_path)
            bundle.load()
            if bundle.ready:
                return
        train_and_package(
            settings.synthetic_data_path,
            settings.model_artifact_path,
            settings.model_manifest_path,
            seed=settings.model_seed,
        )


if __name__ == "__main__":
    main()
