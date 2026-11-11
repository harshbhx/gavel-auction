using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

[JsonConverter(typeof(StringEnumConverter<Reason>))]
public sealed record Reason : OpenStringEnum<Reason>
{
    private Reason(string value) : base(value)
    {
    }

    public static readonly Reason Migrations = new("migrations");

    public static readonly Reason Store = new("store");

    public TResult Match<TResult>(Func<TResult> onMigrations, Func<TResult> onStore, Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == Migrations => onMigrations(),
            _ when this == Store => onStore(),
            _ => otherwise(Value)
        };

    public void Match(Action onMigrations, Action onStore, Action<string> otherwise)
    {
        if (this == Migrations) onMigrations();
        else if (this == Store) onStore();
        else otherwise(Value);
    }
}
