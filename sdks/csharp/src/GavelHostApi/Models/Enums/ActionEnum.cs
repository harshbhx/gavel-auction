using System;
using System.Text.Json.Serialization;
using GavelHostApi.Core.Enum;

namespace GavelHostApi.Models.Enums;

/// <summary>
/// The control to apply.
/// </summary>
[JsonConverter(typeof(StringEnumConverter<ActionEnum>))]
public sealed record ActionEnum : OpenStringEnum<ActionEnum>
{
    private ActionEnum(string value) : base(value)
    {
    }

    public static readonly ActionEnum Open = new("open");

    public static readonly ActionEnum Pause = new("pause");

    public static readonly ActionEnum Resume = new("resume");

    public static readonly ActionEnum Extend = new("extend");

    public static readonly ActionEnum Hammer = new("hammer");

    public TResult Match<TResult>(Func<TResult> onOpen,
        Func<TResult> onPause,
        Func<TResult> onResume,
        Func<TResult> onExtend,
        Func<TResult> onHammer,
        Func<string, TResult> otherwise) =>
        this switch
        {
            _ when this == Open => onOpen(),
            _ when this == Pause => onPause(),
            _ when this == Resume => onResume(),
            _ when this == Extend => onExtend(),
            _ when this == Hammer => onHammer(),
            _ => otherwise(Value)
        };

    public void Match(Action onOpen,
        Action onPause,
        Action onResume,
        Action onExtend,
        Action onHammer,
        Action<string> otherwise)
    {
        if (this == Open) onOpen();
        else if (this == Pause) onPause();
        else if (this == Resume) onResume();
        else if (this == Extend) onExtend();
        else if (this == Hammer) onHammer();
        else otherwise(Value);
    }
}
